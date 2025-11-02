import mongoose from 'mongoose';

const sharedPlaylistSchema = new mongoose.Schema({
  shareId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  playlistId: {
    type: String,
    required: true,
  },
  playlistName: {
    type: String,
    required: true,
    default: 'Shared Playlist',
  },
  playlistImage: {
    type: String,
    default: null,
  },
  moodData: {
    type: Object,
    required: true,
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  views: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

// Indexes
sharedPlaylistSchema.index({ shareId: 1 });
sharedPlaylistSchema.index({ owner: 1, createdAt: -1 });
sharedPlaylistSchema.index({ createdAt: -1 });

// Auto-expire shared playlists after 30 days (optional)
// sharedPlaylistSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

export default mongoose.model('SharedPlaylist', sharedPlaylistSchema);