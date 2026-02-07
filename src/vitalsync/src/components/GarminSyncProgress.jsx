export default function GarminSyncProgress({ progress = 0 }) {
  const isComplete = progress >= 100;

  return (
    <div className="glass-card p-4 border-emerald-800/30 animate-fade-in">
      <div className="flex items-center gap-3">
        {!isComplete ? (
          <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin flex-shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 text-midnight font-bold text-sm">
            {"\u2713"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium">
            {!isComplete ? 'Syncing your Garmin history...' : 'History sync complete!'}
          </p>
          <p className="text-xs text-slate-400">
            {!isComplete
              ? 'Pulling your health data and activities'
              : 'Your dashboard is ready with all your historical data'}
          </p>
        </div>
      </div>
      {!isComplete && (
        <div className="mt-3 h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
