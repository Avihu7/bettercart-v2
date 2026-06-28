import React from 'react';

export default function PageNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-7xl font-light text-slate-300">404</h1>
        <h2 className="text-2xl font-medium text-slate-800">דף לא נמצא</h2>
        <p className="text-slate-600">הדף שחיפשתם אינו קיים.</p>
        <button
          onClick={() => window.location.href = '/dashboard'}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          חזרה לדשבורד
        </button>
      </div>
    </div>
  );
}
