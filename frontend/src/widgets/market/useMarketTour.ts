import { $t } from "@/lang/i18n";
import type { MaybeRef } from "vue";
import { computed, nextTick, onMounted, ref, unref } from "vue";

const MCS_MARKET_TOUR_DONE = "mcs_market_tour_completed";

export function useMarketTour(isAdmin: MaybeRef<boolean>) {
  const step1Ref = ref<HTMLElement | null>(null);
  const step2Ref = ref<HTMLElement | null>(null);
  const step3Ref = ref<HTMLElement | null>(null);
  const openTour = ref(false);
  const tourCurrent = ref(0);

  function setStepRef(index: number, el: unknown) {
    const dom = el ? (el as { $el?: HTMLElement }).$el ?? el : null;
    if (index === 0) step1Ref.value = dom as HTMLElement | null;
    if (index === 1) step2Ref.value = dom as HTMLElement | null;
  }

  const tourSteps = computed(() => {
    const steps: Array<{
      target: () => HTMLElement | null;
      title: string;
      description: string;
    }> = [];
    if (unref(isAdmin)) {
      steps.push({
        target: () => step1Ref.value ?? null,
        title: $t("导入整合包/压缩包/开服包"),
        description: $t("如果需要导入服务端游戏整合包，或者开服包，可以通过这里的方式。")
      });
      steps.push({
        target: () => step2Ref.value ?? null,
        title: $t("使用 Docker 镜像开服"),
        description: $t("对于进阶用户，在 Linux 系统下，可以通过此处来基于镜像创建，支持任何镜像。")
      });
    }
    steps.push({
      target: () => step3Ref.value ?? null,
      title: $t("使用预设包快速创建"),
      description: $t(
        "如果是第一次创建游戏服务器，可以来这里选择我们的预设包哦～，选择后也支持后续再重新安装更改的！"
      )
    });
    return steps as any;
  });

  const markTourDone = () => {
    localStorage.setItem(MCS_MARKET_TOUR_DONE, "1");
    openTour.value = false;
  };

  const startTour = () => {
    if (localStorage.getItem(MCS_MARKET_TOUR_DONE)) return;
    nextTick(() => {
      openTour.value = true;
    });
  };

  onMounted(() => {
    setTimeout(() => {
      startTour();
    }, 1000);
  });

  return {
    step1Ref,
    step2Ref,
    step3Ref,
    openTour,
    tourCurrent,
    tourSteps,
    setStepRef,
    markTourDone
  };
}
