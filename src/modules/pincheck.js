import axios from "axios";
import FormData from "form-data";
import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.js";

export const name = "pincheck";
export const description = "Tìm kiếm hình ảnh liên quan trên Pinterest (Reply ảnh)";

const extractImageUrl = (attachStr) => {
    if (!attachStr) return null;
    try {
        let attachObj = typeof attachStr === "string" ? JSON.parse(attachStr) : attachStr;
        if (Array.isArray(attachObj) && attachObj.length > 0) attachObj = attachObj[0];

        let url = null;
        if (attachObj.params) {
            let paramsObj = typeof attachObj.params === "string" ? JSON.parse(attachObj.params) : attachObj.params;
            if (paramsObj.hd) url = paramsObj.hd;
            else if (paramsObj.url) url = paramsObj.url;
        }
        if (!url && attachObj.href) url = attachObj.href;

        if (url && typeof url === 'string') {
            url = url.trim().replace(/^"|"$/g, '');
            if (url.startsWith("http")) return url;
        }
    } catch (e) { }
    return null;
};

export const commands = {
    pincheck: async (ctx) => {
        const { api, threadId, threadType, message } = ctx;
        
        const imageUrl = extractImageUrl(message.data?.quote?.attach) || extractImageUrl(message.data?.attach);

        if (!imageUrl) {
            return api.sendMessage({ msg: "⚠️ Vui lòng reply một ảnh (hoặc gửi kèm ảnh) để dùng lệnh tìm kiếm!" }, threadId, threadType);
        }

        const tempDir = path.join(process.cwd(), "src/modules/cache");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const tempPath = path.join(tempDir, `pincheck_src_${Date.now()}.jpg`);
        const tempFiles = [];

        try {
            await api.sendMessage({ msg: "⏳ Đang phân tích và tìm kiếm ảnh trên Pinterest..." }, threadId, threadType);

            // 1. Download image
            const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            fs.writeFileSync(tempPath, Buffer.from(imgRes.data));

            // 2. Perform Visual Search
            const data = await pinterestVisualSearch(tempPath);

            let imageCount = 0;
            let videoCount = 0;
            const imageUrls = [];

            if (data.data) {
                data.data.forEach(item => {
                    if (item.story_pin_data) {
                        item.story_pin_data.pages_preview?.forEach(page => {
                            if (page.video?.video_list?.V_HEVC_MP4_T4_V2?.url) {
                                videoCount++;
                            }
                        });
                    }
                    if (item.image_medium_url) {
                        imageCount++;
                        imageUrls.push(item.image_medium_url);
                    }
                });
            }

            if (imageUrls.length === 0) {
                return api.sendMessage({ msg: "⚠️ Không tìm thấy kết quả nào tương tự trên Pinterest." }, threadId, threadType);
            }

            // 3. Download top 5 images
            const imagesToDownload = imageUrls.slice(0, 5);
            for (let i = 0; i < imagesToDownload.length; i++) {
                try {
                    const dlRes = await axios.get(imagesToDownload[i], { responseType: 'arraybuffer' });
                    const contentType = dlRes.headers['content-type'] || 'image/jpeg';
                    let ext = 'jpg';
                    if (contentType.includes('png')) ext = 'png';
                    else if (contentType.includes('gif')) ext = 'gif';
                    else if (contentType.includes('webp')) ext = 'webp';

                    const p = path.join(tempDir, `pin_res_${Date.now()}_${i}.${ext}`);
                    fs.writeFileSync(p, Buffer.from(dlRes.data));
                    tempFiles.push(p);
                } catch (err) {
                    log.error(`Lỗi tải ảnh con từ Pinterest: ${err.message}`);
                }
            }

            // 4. Send Message
            const summary = `[ 📌 PINTEREST LENS ]\n─────────────────\n🔎 Phát hiện: ${imageCount} ảnh | ${videoCount} video\n✨ Gửi kèm: ${tempFiles.length} kết quả đẹp nhất.`;

            await api.sendMessage({
                msg: summary,
                attachments: tempFiles
            }, threadId, threadType);

        } catch (error) {
            log.error("Pincheck error:", error.message);
            api.sendMessage({ msg: `⚠️ Hệ thống nhận diện đang bận hoặc lỗi. Vui lòng thử lại sau!` }, threadId, threadType);
        } finally {
            try {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                tempFiles.forEach(file => {
                    if (fs.existsSync(file)) fs.unlinkSync(file);
                });
            } catch (e) {
                log.error("Clean temp files pincheck error.");
            }
        }
    }
};

async function pinterestVisualSearch(imagePath) {
    try {
        const form = new FormData();
        form.append('fields', `pin.{favorited_by_me,is_downstream_promotion,is_whitelisted_for_tried_it,description,comments_disabled,created_at,is_stale_product,is_video,promoted_is_max_video,link,id,pinner(),top_interest,promoted_quiz_pin_data,reaction_counts,domain_tracking_params,board(),promoter(),is_eligible_for_hybrid_search,ad_data(),is_premiere,image_signature,story_pin_data(),ad_destination_url,is_promoted,sponsorship,image_square_url,native_creator(),videos(),virtual_try_on_type,destination_url_type,grid_title,is_year_in_preview,media_attribution,view_tags,rich_summary(),promoted_is_catalog_carousel_ad,aggregated_pin_data(),promoted_is_auto_assembled,is_ghost,category,is_oos_product,image_medium_url,dark_profile_link,is_full_width,call_to_action_text,additional_hide_reasons,comment_count,promoted_is_quiz,ad_match_reason,is_unsafe_for_comments,promoted_is_sideswipe_disabled,is_eligible_for_aggregated_comments,is_eligible_for_related_products,dpa_creative_type,origin_pinner(),is_unsafe,is_native,ad_targeting_attribution,is_owned_by_viewer,ad_closeup_behaviors,source_interest(),question_comment_id,image_crop,collection_pin(),shuffle(),shopping_mdl_browser_type,should_mute,shopping_flags,promoted_lead_form(),promoted_is_showcase,is_eligible_for_web_closeup,domain,story_pin_data,tracking_params,mobile_link,share_count,cacheable_id,tracked_link,is_eligible_for_brand_catalog,done_by_me,is_shopping_ad,title,carousel_data(),type,attribution,is_repin,promoted_is_lead_ad,comment_reply_comment_id,should_open_in_stream,dominant_color,product_pin_data(),item_id,embed(),alt_text,promoted_ios_deep_link,repin_count,is_eligible_for_pdp,promoted_is_removable,music_attributions,is_eligible_for_pre_loved_goods_label},board.{image_cover_url,layout,owner(),id,privacy,is_ads_only,followed_by_me,name,image_thumbnail_url},interest.{follower_count,id,key,type,name,is_followed},productmetadatav2.{items},itemmetadata.{additional_images},richpingriddata.{aggregate_rating,id,type_name,products(),site_name,display_cook_time,is_product_pin_v2,display_name,actions,mobile_app},aggregatedpindata.{collections_header_text,catalog_collection_type,pin_tags,id,is_shop_the_look,dpa_layout_type,has_xy_tags,is_dynamic_collections,aggregated_stats,pin_tags_chips,slideshow_collections_aspect_ratio},pincarouselslot.{domain,details,item_id,id,title,link,image_signature,ios_deep_link,rich_summary,rich_metadata,ad_destination_url},shuffle.{source_app_type_detailed,is_promoted,id,is_auto_created,is_remixable,tracking_params,is_pinterest_source,type},embed.{width,type,height,src},pincarouseldata.{carousel_slots,id,index,rich_metadata(),rich_summary()},storypindata.{metadata,has_product_pins,id,static_page_count,has_affiliate_products,total_video_duration,type,pages_preview,page_count},storypinpage.{blocks,style,layout,id,image_signature_adjusted,video_signature,image_signature,music_attributions,type,should_mute,video[V_HLSV3_MOBILE,V_HLS_HEVC,V_HEVC_MP4_T1_V2,V_HEVC_MP4_T2_V2,V_HEVC_MP4_T3_V2,V_HEVC_MP4_T4_V2,V_HEVC_MP4_T5_V2]},collectionpinitem.{pin_id,images,is_editable,source,price_value,title,dominant_color,link,image_signature,price_currency,showcase_features_count},storypinvideoblock.{text,block_style,video_signature,type,block_type,video[V_HLSV3_MOBILE,V_HLS_HEVC,V_HEVC_MP4_T1_V2,V_HEVC_MP4_T2_V2,V_HEVC_MP4_T3_V2,V_HEVC_MP4_T4_V2,V_HEVC_MP4_T5_V2]},collectionpin.{collections_header_text,catalog_collection_type,root_pin_id,dpa_layout_type,item_data,is_dynamic_collections,slideshow_collections_aspect_ratio},storypinimageblock.{image_signature,block_style,type,block_type,text},user.{is_verified_merchant,explicitly_followed_by_me,first_name,id,image_small_url,show_creator_profile,verified_identity,full_name,native_pin_count,username},video.{id,video_list[V_HLSV3_MOBILE,V_HLS_HEVC]},pin.images[564x,1200x],interest.images[70x70,236x],pincarouselslot.images[564x,1200x],imagemetadata.canonical_images[1200x,474x],storypinimageblock.image[564x,1200x],storypinpage.image_adjusted[1200x,345x,736x],storypinpage.image[1200x,345x,736x]`);
        form.append('y', '0');
        form.append('crop_source', '5');
        form.append('page_size', '18');
        form.append('w', '1');
        form.append('search_type', '2');
        form.append('h', '1');
        form.append('source_type', '1');
        form.append('x', '0');
        form.append('image', fs.createReadStream(imagePath), { filename: 'myphoto.jpg', contentType: 'image/jpeg' });

        const response = await axios.post('https://api.pinterest.com/v3/visual_search/lens/search/', form, {
            headers: {
                ...form.getHeaders(),
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'vi-VN',
                'Authorization': 'Bearer MTQzMTU5NDo5NzgyNjY0ODc3MTY2MTU3ODQ6OTIyMzM3MjAzNjg1NDc3NTgwNzoxfDE3NTQwMzE3NDM6MC0tMDBkM2IxYjEwZTUxNDJhYjA0NDQyMzJlZDQzNDYzMjk=',
                'Connection': 'keep-alive',
                'Host': 'api.pinterest.com',
                'User-Agent': 'Pinterest for iOS/13.28 (iPhone11,6; 18.3.2)',
                'X-B3-ParentSpanId': '45a05a3b443dabd3',
                'X-B3-SpanId': 'b200a44bb4af08ca',
                'X-B3-TraceId': '5ef0884b235e8d19',
                'X-Pinterest-Advertising-Id': '1D80A6B1-D3C8-454E-A603-30DF43EC8831',
                'X-Pinterest-App-Type-Detailed': '1',
                'X-Pinterest-AppState': 'active',
                'X-Pinterest-Device': 'iPhone11,6',
                'X-Pinterest-H3-Max-Age': '604800',
                'X-Pinterest-InstallId': '27202ade962146f188abcbdb00c3aaa7'
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error making Pinterest API request:', error.message);
        throw error;
    }
}
