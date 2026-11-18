import React from 'react';

const GROUPS = [
  { key: 'goals', title: 'מה אתם צריכים', cls: 'bg-periwinkle-100 text-[#0C084A]' },
  { key: 'concerns', title: 'מה מטריד אתכם', cls: 'bg-amber-50 text-amber-900' },
  { key: 'missing', title: 'מה חסר בתיק', cls: 'bg-mist-50 text-mist-700' },
];

export default function StoryInsights({ story }) {
  if (!story) return null;
  const any = GROUPS.some(g => story[g.key]?.length);
  if (!any) return null;
  return (
    <div className="grid sm:grid-cols-3 gap-3">
      {GROUPS.map(g => story[g.key]?.length ? (
        <div key={g.key} className={`rounded-2xl p-4 ${g.cls}`}>
          <p className="text-xs font-black mb-2">{g.title}</p>
          <ul className="space-y-1">
            {story[g.key].map((s, i) => <li key={i} className="text-xs leading-relaxed">• {s}</li>)}
          </ul>
        </div>
      ) : null)}
    </div>
  );
}