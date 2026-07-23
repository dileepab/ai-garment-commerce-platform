export function isInstagramLoginAccessToken(accessToken: string): boolean {
  return accessToken.trim().startsWith('IG');
}
