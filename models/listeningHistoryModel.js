import mongoose from 'mongoose';

const listeningHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    trackId: { type: String, required: true },
    trackName: { type: String, required: true },
    artistName: { type: String, default: 'Unknown' },
    albumName: { type: String, default: 'Unknown' },
    albumImage: { type: String, default: null },
    mood: { type: String, default: 'Unknown' },
    confidence: { type: Number, default: 0 },
    features: {
      valence: { type: Number, default: 0.5 },
      energy: { type: Number, default: 0.5 },
      danceability: { type: Number, default: 0.5 },
      acousticness: { type: Number, default: 0.5 },
      tempo: { type: Number, default: 120 },
      speechiness: { type: Number, default: 0.05 },
      instrumentalness: { type: Number, default: 0.0 },
      liveness: { type: Number, default: 0.1 },
      loudness: { type: Number, default: -8 },
    },
    progressMs: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    playedAt: { type: Date, default: Date.now, index: true },
    dayBucket: { type: String, index: true },
  },
  { timestamps: true }
);

listeningHistorySchema.index({ userId: 1, playedAt: -1 });
listeningHistorySchema.index({ userId: 1, dayBucket: 1 });

listeningHistorySchema.pre('save', function (next) {
  const d = this.playedAt || new Date();
  this.dayBucket = d.toISOString().slice(0, 10);
  next();
});

const ListeningHistory = mongoose.model('ListeningHistory', listeningHistorySchema);
export default ListeningHistory;
