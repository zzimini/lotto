import LottoMachine from "@/components/LottoMachine";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-4 py-8 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
        <span className="text-amber-300">LOTTO</span> 추첨기
      </h1>
      <p className="mt-2 text-sm text-indigo-200/80">
        공이 섞이다가 하나씩 뽑혀 나와요 · 1~45 중 6개 + 보너스
      </p>
      <LottoMachine />
      <p className="mt-10 text-center text-xs text-indigo-200/50">
        재미로 보는 무작위 번호예요. 당첨을 보장하지 않습니다.
      </p>
    </main>
  );
}
