const cooldowns = new Map();

/**
 * Quản lý thời gian hồi lệnh (Cooldown)
 */
export const cooldownManager = {
    /**
     * Kiểm tra xem user có đang trong thời gian chờ không
     * @param {string} senderId - ID người gửi
     * @param {string} commandName - Tên lệnh
     * @param {number} cooldownTime - Thời gian chờ (giây)
     * @returns {number|null} - Trả về số giây còn lại, hoặc null nếu hết cooldown
     */
    getRemainingCooldown(senderId, commandName, cooldownTime = 5) {
        const key = `${senderId}_${commandName}`;
        const now = Date.now();
        const expirationTime = cooldowns.get(key) || 0;

        if (now < expirationTime) {
            const timeLeft = (expirationTime - now) / 1000;
            return Math.ceil(timeLeft);
        }

        return null;
    },

    /**
     * Đặt cooldown cho user
     * @param {string} senderId 
     * @param {string} commandName 
     * @param {number} cooldownTime 
     */
    setCooldown(senderId, commandName, cooldownTime = 5) {
        const key = `${senderId}_${commandName}`;
        const expirationTime = Date.now() + cooldownTime * 1000;
        cooldowns.set(key, expirationTime);
        
        // Tự động xóa sau khi hết hạn để tránh tràn RAM
        setTimeout(() => cooldowns.delete(key), cooldownTime * 1000);
    }
};
