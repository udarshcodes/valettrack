import React from 'react';

export function StatusBadge({ status, size = 'sm' }) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  switch (status) {
    case 'Available':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-[#10E599]/10 text-[#10E599] border border-[#10E599]/30 ${sizeClasses}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#10E599] animate-pulse"></span>
          Available
        </span>
      );
    case 'Occupied':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 ${sizeClasses}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
          Occupied
        </span>
      );
    case 'Reserved':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 ${sizeClasses}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
          Reserved
        </span>
      );
    case 'Active':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 ${sizeClasses}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          Active
        </span>
      );
    case 'Completed':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-slate-500/10 text-slate-400 border border-slate-700 ${sizeClasses}`}>
          Completed
        </span>
      );
    default:
      return (
        <span className={`inline-flex items-center rounded-full bg-slate-800 text-slate-300 ${sizeClasses}`}>
          {status}
        </span>
      );
  }
}
