/** 번호대별 공 색상 [기본색, 그림자색] */
export function ballColors(n: number): [string, string] {
  if (n <= 10) return ["#fbc400", "#b78a00"];
  if (n <= 20) return ["#4fb3ea", "#1f6f9e"];
  if (n <= 30) return ["#ff6464", "#b32b2b"];
  if (n <= 40) return ["#a7a7b3", "#5f5f6b"];
  return ["#9ad13a", "#5a8a14"];
}
