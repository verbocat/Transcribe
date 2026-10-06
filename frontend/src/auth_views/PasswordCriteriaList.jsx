import React from 'react';
import { Check, Circle } from 'lucide-react';
import { checkPasswordCriteria } from './authService';
import { useTheme } from '../context/ThemeContext';

export default function PasswordCriteriaList({ password }) {
  const { isDark } = useTheme();
  const criteria = checkPasswordCriteria(password);

  const items = [
    { key: 'min_length', label: '8+ characters', met: criteria.min_length },
    { key: 'has_lowercase', label: 'Lowercase (a-z)', met: criteria.has_lowercase },
    { key: 'has_uppercase', label: 'Uppercase (A-Z)', met: criteria.has_uppercase },
    { key: 'has_number', label: 'Number (0-9)', met: criteria.has_number },
    { key: 'has_symbol', label: 'Symbol (!@#$)', met: criteria.has_symbol },
  ];

  return (
    <div className={`rounded-lg p-2.5 my-1 transition-colors ${isDark ? 'bg-[var(--kt-s0)] border border-[var(--kt-s4)]' : 'bg-slate-50 border border-slate-200'}`}>
      <div className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
        Password Requirements:
      </div>
      <ul className="grid grid-cols-2 gap-1.5 list-none p-0 m-0">
        {items.map((item) => (
          <li
            key={item.key}
            className={`flex items-center gap-1.5 text-[10.5px] transition-colors ${
              item.met
                ? isDark ? 'text-[var(--kt-accent)] font-semibold' : 'text-blue-700 font-semibold'
                : isDark ? 'text-slate-500' : 'text-slate-400'
            }`}
          >
            {item.met ? (
              <Check size={12} strokeWidth={3} className={isDark ? "text-[var(--kt-accent)] shrink-0" : "text-blue-600 shrink-0"} />
            ) : (
              <Circle size={8} strokeWidth={2} className={isDark ? "text-slate-600 shrink-0" : "text-slate-300 shrink-0"} />
            )}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
