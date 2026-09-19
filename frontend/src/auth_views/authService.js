import { API_BASE } from '../config';

/**
 * Authentication API Client for VerboLabs Auth
 */
export async function signupUser({ name, email, password, confirm_password, employee_id }) {
  const res = await fetch(`${API_BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      email,
      password,
      confirm_password,
      employee_id: employee_id || null
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Signup failed. Please check your information.');
  }
  return data;
}

export async function loginUser({ name, email, password, operating_location, bot_challenge_token }) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name || null,
      email,
      password,
      operating_location,
      bot_challenge_token: bot_challenge_token || null
    })
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.detail || 'Login failed. Please verify your credentials.');
    err.status = res.status;
    err.detail = data.detail;
    throw err;
  }
  return data;
}

export async function getBotChallenge() {
  const res = await fetch(`${API_BASE}/api/auth/bot-challenge`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to fetch verification challenge.');
  }
  return data;
}

export async function getTakeoverStatus(takeover_id) {
  const res = await fetch(`${API_BASE}/api/auth/takeover/status?takeover_id=${encodeURIComponent(takeover_id)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to check takeover status.');
  }
  return data;
}

export async function submitTakeoverDecision({ takeover_id, decision, token }) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/api/auth/takeover/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      takeover_id,
      decision
    })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to submit decision.');
  }
  return data;
}

export async function verifyLoginOtp({ challenge_id, otp }) {
  const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge_id,
      otp
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Invalid verification code.');
  }
  return data;
}

export async function resendLoginOtp({ challenge_id }) {
  const res = await fetch(`${API_BASE}/api/auth/resend-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to resend verification code.');
  }
  return data;
}

export async function verifyEmailToken(token) {
  const res = await fetch(`${API_BASE}/api/auth/verify-email?token=${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Verification failed or link expired.');
  }
  return data;
}

export async function resendVerification(email) {
  const res = await fetch(`${API_BASE}/api/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to resend verification email.');
  }
  return data;
}

export async function requestPasswordReset(email) {
  const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to send password reset link.');
  }
  return data;
}

export async function resetPassword({ token, password, confirm_password }) {
  const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      password,
      confirm_password
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to update password.');
  }
  return data;
}

export async function fetchCurrentUser(token) {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Session expired.');
  }
  return data.user;
}

export async function logoutUser(token) {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
  } catch (err) {
    console.warn('Logout notification error:', err);
  }
}

/**
 * Client-side evaluation of password criteria for real-time visual checklist
 */
export function checkPasswordCriteria(password = '') {
  return {
    min_length: password.length >= 8,
    has_lowercase: /[a-z]/.test(password),
    has_uppercase: /[A-Z]/.test(password),
    has_number: /[0-9]/.test(password),
    has_symbol: /[!@#$%^&*(),.?":{}|<>[\]\\/'`~_+=;-]/.test(password)
  };
}
