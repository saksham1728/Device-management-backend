const mongoose = require('mongoose');

const tokenBlacklistSchema = new mongoose.Schema({
  token: { 
    type: String, 
    required: true, 
    unique: true 
  },
  type: { 
    type: String, 
    enum: ['access', 'refresh'], 
    required: true 
  },
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  reason: {
    type: String,
    enum: ['logout', 'revoked', 'security', 'expired'],
    default: 'logout'
  },
  expiresAt: { 
    type: Date, 
    required: true 
  },
  blacklistedAt: { 
    type: Date, 
    default: Date.now 
  },
  userAgent: { 
    type: String, 
    default: null 
  },
  ip: { 
    type: String, 
    default: null 
  }
}, { timestamps: true });

// Index for efficient querying and automatic cleanup
tokenBlacklistSchema.index({ token: 1 });
tokenBlacklistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
tokenBlacklistSchema.index({ userId: 1, blacklistedAt: -1 });

// Static method to check if token is blacklisted
tokenBlacklistSchema.statics.isBlacklisted = async function(token) {
  const blacklistedToken = await this.findOne({ token });
  return !!blacklistedToken;
};

// Static method to blacklist token
tokenBlacklistSchema.statics.blacklistToken = async function(token, type, userId, expiresAt, reason = 'logout', userAgent = null, ip = null) {
  try {
    await this.create({
      token,
      type,
      userId,
      expiresAt,
      reason,
      userAgent,
      ip
    });
    return true;
  } catch (error) {
    if (error.code === 11000) {
      // Token already blacklisted
      return true;
    }
    throw error;
  }
};

// Static method to clean expired blacklisted tokens
tokenBlacklistSchema.statics.cleanExpired = async function() {
  const result = await this.deleteMany({ expiresAt: { $lt: new Date() } });
  return result.deletedCount;
};

module.exports = mongoose.model('TokenBlacklist', tokenBlacklistSchema);