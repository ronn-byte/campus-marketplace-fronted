export function passwordsMatch(password, confirmPassword) {
  return password === confirmPassword;
}

export function registrationPayload({ displayName, email, password }) {
  return { displayName, email, password };
}
