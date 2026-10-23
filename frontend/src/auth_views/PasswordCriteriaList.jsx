import React from 'react';
import { Check, Circle } from 'lucide-react';
import { checkPasswordCriteria } from './authService';

export default function PasswordCriteriaList({ password }) {
  const criteria = checkPasswordCriteria(password);

  const items = [
    { key: 'min_length', label: 'At least 8 characters', met: criteria.min_length },
    { key: 'has_lowercase', label: 'A lowercase letter', met: criteria.has_lowercase },
    { key: 'has_uppercase', label: 'An uppercase letter', met: criteria.has_uppercase },
    { key: 'has_number', label: 'A number', met: criteria.has_number },
    { key: 'has_symbol', label: 'A symbol, like !@#$', met: criteria.has_symbol },
  ];

  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 list-none p-0 m-0 px-0.5" aria-label="Password requirements">
      {items.map((item) => (
        <li
          key={item.key}
          className={`flex items-center gap-2 text-xs transition-colors ${item.met ? 'text-[var(--kt-success)] font-medium' : 'text-[var(--kt-faint)]'}`}
        >
          {item.met ? <Check size={13} strokeWidth={3} className="shrink-0" /> : <Circle size={9} strokeWidth={2} className="shrink-0" />}
          <span>{item.label}</span>
          <span className="sr-only">{item.met ? 'met' : 'not met'}</span>
        </li>
      ))}
    </ul>
  );
}
