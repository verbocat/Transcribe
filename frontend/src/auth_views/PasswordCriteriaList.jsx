import React from 'react';
import { Check, Circle } from 'lucide-react';
import { checkPasswordCriteria } from './authService';

export default function PasswordCriteriaList({ password }) {
  const criteria = checkPasswordCriteria(password);

  const items = [
    { key: 'min_length', label: '8+ characters', met: criteria.min_length },
    { key: 'has_lowercase', label: 'Lowercase (a-z)', met: criteria.has_lowercase },
    { key: 'has_uppercase', label: 'Uppercase (A-Z)', met: criteria.has_uppercase },
    { key: 'has_number', label: 'Number (0-9)', met: criteria.has_number },
    { key: 'has_symbol', label: 'Symbol (!@#$)', met: criteria.has_symbol },
  ];

  return (
    <div className="bg-[#0e0f12] border border-[#262734] rounded-lg p-2.5 my-1">
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
        Password Requirements:
      </div>
      <ul className="grid grid-cols-2 gap-1.5 list-none p-0 m-0">
        {items.map((item) => (
          <li
            key={item.key}
            className={`flex items-center gap-1.5 text-[10.5px] transition-colors ${
              item.met ? 'text-[#00e5be] font-semibold' : 'text-slate-500'
            }`}
          >
            {item.met ? (
              <Check size={12} strokeWidth={3} className="text-[#00e5be] shrink-0" />
            ) : (
              <Circle size={8} strokeWidth={2} className="text-slate-600 shrink-0" />
            )}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
