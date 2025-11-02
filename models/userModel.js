import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  spotifyId: { 
    type: String, 
    required: true, 
    unique: true,
  },
  displayName: { 
    type: String,
    default: 'Spotify User',
  },
  email: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    trim: true,
  },
  avatarUrl: {
    type: String,
    default: null,
  },
  
  // Primary Spotify tokens
  accessToken: { 
    type: String, 
    required: true,
  },
  refreshToken: { 
    type: String, 
    required: true,
  },
  tokenExpires: { 
    type: Date,
  },
  
  // User preferences for personalization
  preferences: {
    preferredGenres: {
      type: [String],
      default: [],
    },
    moodSensitivity: { 
      type: Number, 
      default: 0.5,
      min: 0,
      max: 1,
    },
    autoOptimizeFlow: {
      type: Boolean,
      default: false,
    },
    defaultPlaylistPrivacy: {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
    },
    language: {
      type: String,
      default: 'en',
    },
    notifications: {
      type: Boolean,
      default: true,
    },
  },

  // Secondary service tokens (YouTube Music, Apple Music)
  authTokens: {
    type: Map,
    of: new mongoose.Schema({
      accessToken: { 
        type: String, 
        required: true,
      },
      refreshToken: { 
        type: String,
        default: null,
      },
      tokenExpires: { 
        type: Date,
        default: null,
      },
    }, { _id: false }),
    default: new Map(),
  },
  // Structure example:
  // authTokens: {
  //   'youtube': { accessToken: '...', refreshToken: '...', tokenExpires: '...' },
  //   'apple': { accessToken: '...', refreshToken: null, tokenExpires: null }
  // }

  // User activity tracking
  lastActive: {
    type: Date,
    default: Date.now,
  },
  playlistsAnalyzed: {
    type: Number,
    default: 0,
  },
  
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes for better query performance - Define them here to avoid duplicates
userSchema.index({ email: 1 });
userSchema.index({ spotifyId: 1 });
userSchema.index({ lastActive: -1 });

// Virtual for linked services
userSchema.virtual('linkedServices').get(function() {
  if (!this.authTokens) return [];
  return Array.from(this.authTokens.keys());
});

// Method to check if token is expired
userSchema.methods.isTokenExpired = function() {
  return this.tokenExpires && this.tokenExpires < Date.now();
};

// Method to check if service is linked
userSchema.methods.isServiceLinked = function(service) {
  return this.authTokens && this.authTokens.has(service);
};

// Pre-save middleware to update lastActive
userSchema.pre('save', function(next) {
  this.lastActive = Date.now();
  next();
});

export default mongoose.model('User', userSchema);