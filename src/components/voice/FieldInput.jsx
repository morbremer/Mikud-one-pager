import React from 'react';

// שדה עריכה פשוט לפי סוג השדה
export default function FieldInput({ field, value, onChange }) {
  const base = 'w-full h-11 px-4 rounded-xl border border-mist-200 bg-white text-[#0C084A] text-sm focus:outline-none focus:border-[#0153F4] focus:ring-2 focus:ring-[#0153F4]/15';
  if (field.type === 'select') {
    return (
      <select className={base} value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">בחרו...</option>
        {field.options.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
      </select>
    );
  }
  if (field.type === 'date') {
    return <input type="date" className={base} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  }
  const numeric = ['money', 'number', 'digits'].includes(field.type);
  return (
    <input
      className={base}
      dir={numeric || field.key === 'email' ? 'ltr' : 'rtl'}
      inputMode={numeric ? 'numeric' : undefined}
      value={value || ''}
      placeholder={field.type === 'money' ? 'סכום בש״ח' : ''}
      onChange={(e) => onChange(numeric ? e.target.value.replace(/[^\d]/g, '') : e.target.value)}
    />
  );
}