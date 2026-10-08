import { API_BASE, getApiBase } from '../config';

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return res;
  } catch (err) {
    if (err.name === 'AbortError') {
      const activeTarget = getApiBase() || 'http://localhost:8001';
      throw new Error(`Connection timed out after ${timeoutMs / 1000}s. Please verify the backend server is running and reachable at ${activeTarget}.`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Authentication API Client for VerboLabs Auth
 */
export async function signupUser({ name, email, password, confirm_password }) {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      email,
      password,
      confirm_password
    })
  }, 15000);

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Signup failed. Please check your information.');
  }
  return data;
}

export async function loginUser({ email, password, bot_challenge_token }) {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      bot_challenge_token: bot_challenge_token || null
    })
  }, 15000);

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
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/auth/bot-challenge`, {}, 8000);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to fetch verification challenge.');
  }
  return data;
}

export async function verifyLoginOtp({ challenge_id, otp }) {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge_id,
      otp
    })
  }, 15000);

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.detail || 'Invalid verification code.');
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function resendLoginOtp({ challenge_id }) {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/auth/resend-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id })
  }, 15000);

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to resend verification code.');
  }
  return data;
}

// OTP sign-in step 1: email a code to the account (no password needed)
export async function requestLoginOtp({ email, bot_challenge_token }) {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/auth/login/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, bot_challenge_token: bot_challenge_token || null })
  }, 20000);

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.detail || 'Failed to send the verification code.');
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function verifyEmailToken(token) {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/auth/verify-email?token=${encodeURIComponent(token)}`, {}, 10000);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Verification failed or link expired.');
  }
  return data;
}

export async function resendVerification(email) {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  }, 12000);

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to resend verification email.');
  }
  return data;
}

export async function requestPasswordReset(email) {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  }, 15000);

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to send password reset link.');
  }
  return data;
}

export async function resetPassword({ token, password, confirm_password }) {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      password,
      confirm_password
    })
  }, 15000);

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to update password.');
  }
  return data;
}

export async function fetchCurrentUser(token) {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/auth/me`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }, 8000);

  const data = await res.json().catch(() => ({ detail: res.statusText || 'Response error' }));
  if (!res.ok) {
    const error = new Error(data.detail || 'Session expired.');
    error.status = res.status;
    throw error;
  }
  return data.user;
}

export async function logoutUser(token) {
  try {
    const base = getApiBase();
    await fetchWithTimeout(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }, 5000);
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
