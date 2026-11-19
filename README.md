# lotto

진짜 추첨기처럼 투명한 드럼 안에서 공이 굴러다니다가 하나씩 뽑혀 나오는 로또 번호 생성기.

- Next.js 16 · React 19 · Tailwind 4 · TypeScript · pnpm
- 번호는 `crypto.getRandomValues`로 공정하게 뽑습니다 (1~45 중 6개 + 보너스 1개)

```bash
pnpm install
pnpm dev   # http://localhost:3000
```
