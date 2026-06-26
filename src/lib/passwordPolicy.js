const MIN_PASSWORD_LENGTH = 8;

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!/[a-z]/.test(password)) {
    return 'Include at least one lowercase letter.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Include at least one uppercase letter.';
  }
  if (!/\d/.test(password)) {
    return 'Include at least one number.';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Include at least one symbol.';
  }
  return null;
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  validatePassword,
};
