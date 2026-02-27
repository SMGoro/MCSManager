<script setup lang="ts">
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { useOverviewInfo } from "@/hooks/useOverviewInfo";
import { t } from "@/lang/i18n";
import { getProgressStrokeColor } from "@/tools/progressColor";
import type { LayoutCard } from "@/types";
import {
  AppstoreOutlined,
  FlagOutlined,
  HddOutlined,
  NodeExpandOutlined
} from "@ant-design/icons-vue";
import type { Component } from "vue";
import { computed } from "vue";

const props = defineProps<{
  card: LayoutCard;
}>();

const { state } = useOverviewInfo();
const { getMetaValue } = useLayoutCardTools(props.card);

const type = getMetaValue<string>("type");

interface BaseStatusItem {
  type: string;
  title: string;
  icon: Component;
}

interface NodeStatusItem extends BaseStatusItem {
  type: "node";
  available: number;
  total: number;
}

interface InstanceStatusItem extends BaseStatusItem {
  type: "instance";
  running: number;
  total: number;
}

interface UsersStatusItem extends BaseStatusItem {
  type: "users";
  loginFailed: number;
  logined: number;
}

interface SystemStatusItem extends BaseStatusItem {
  type: "system";
  cpuPercent: number;
  memUsedPercent: number;
  memUsedGB: number;
  memTotalGB: number;
}

type StatusItem = NodeStatusItem | InstanceStatusItem | UsersStatusItem | SystemStatusItem;

const computedStatusList = computed<StatusItem[]>(() => {
  if (!state.value) return [];

  const s = state.value;
  const memUsedPercent = Math.round(100 - Number(s.mem));
  const memTotalGB = Number((s.system.totalmem / 1024 / 1024 / 1024).toFixed(1));
  const memUsedGB = Number((memTotalGB - s.system.freemem / 1024 / 1024 / 1024).toFixed(1));

  return [
    {
      type: "node",
      title: t("TXT_CODE_4b7eba50"),
      icon: NodeExpandOutlined,
      available: s?.remoteCount?.available ?? 0,
      total: s?.remoteCount?.total ?? 0
    },
    {
      type: "instance",
      title: t("TXT_CODE_8201d2c6"),
      icon: AppstoreOutlined,
      running: s.runningInstance,
      total: s.totalInstance
    },
    {
      type: "users",
      title: t("TXT_CODE_871fb0d6"),
      icon: FlagOutlined,
      loginFailed: s.record.loginFailed,
      logined: s.record.logined
    },
    {
      type: "system",
      title: t("TXT_CODE_f4244bbf"),
      icon: HddOutlined,
      cpuPercent: s.cpu,
      memUsedPercent,
      memUsedGB,
      memTotalGB
    }
  ];
});

const realStatus = computed(() => computedStatusList.value.find((v) => v.type === type));
</script>

<template>
  <CardPanel class="StatusBlock" style="height: 100%">
    <template #title>{{ card.title }}</template>
    <template #body>
      <div class="status-header">
        <component :is="realStatus?.icon" class="status-header__icon" />
        <a-typography-text class="status-header__title color-info">
          {{ realStatus?.title }}
        </a-typography-text>
      </div>

      <!-- Nodes: progress bar + two tags -->
      <template v-if="realStatus?.type === 'node'">
        <a-progress
          :percent="
            realStatus.total ? Math.round((realStatus.available / realStatus.total) * 100) : 0
          "
          :stroke-width="12"
          :show-info="false"
          class="status-progress"
        />
        <div class="status-tags">
          <a-tag color="green">{{ realStatus.available }} {{ t("TXT_CODE_823bfe63") }}</a-tag>
          <a-tag color="blue">{{ realStatus.total }} {{ t("TXT_CODE_ALL") }}</a-tag>
        </div>
      </template>

      <!-- Instances: progress bar + two tags -->
      <template v-else-if="realStatus?.type === 'instance'">
        <a-progress
          :percent="
            realStatus.total ? Math.round((realStatus.running / realStatus.total) * 100) : 0
          "
          :stroke-color="
            getProgressStrokeColor(
              realStatus.total ? Math.round((realStatus.running / realStatus.total) * 100) : 0
            )
          "
          :show-info="false"
          :stroke-width="12"
          class="status-progress"
        />
        <div class="status-tags">
          <a-tag color="green">{{ realStatus.running }} {{ t("TXT_CODE_bdb620b9") }}</a-tag>
          <a-tag color="default">{{ realStatus.total }} {{ t("TXT_CODE_ALL") }}</a-tag>
        </div>
      </template>

      <!-- User login: two tags -->
      <template v-else-if="realStatus?.type === 'users'">
        <div class="status-tags status-tags--wrap">
          <a-tag color="red">
            <span class="status-tag-label">{{
              t("TXT_CODE_871fb0d6")
                .replace(/\s*:.*$/, "")
                .trim()
            }}</span>
            <span class="status-tag-value">{{ realStatus.loginFailed }}</span>
          </a-tag>
          <a-tag color="green">
            <span class="status-tag-label">{{
              t("TXT_CODE_871fb0d6")
                .replace(/^[^:]*:\s*/, "")
                .trim()
            }}</span>
            <span class="status-tag-value">{{ realStatus.logined }}</span>
          </a-tag>
        </div>
      </template>

      <!-- System CPU / RAM: two progress bars + percent and value -->
      <template v-else-if="realStatus?.type === 'system'">
        <div class="status-bars">
          <div class="status-bar-item">
            <span class="status-bar-label">CPU</span>
            <a-progress
              :percent="realStatus.cpuPercent"
              :stroke-color="getProgressStrokeColor(realStatus.cpuPercent)"
              :stroke-width="12"
              :show-info="false"
            />
            <div class="status-bar-value">
              <span class="status-bar-value__percent">{{ realStatus.cpuPercent }}%</span>
            </div>
          </div>
          <div class="status-bar-item">
            <span class="status-bar-label">RAM</span>
            <a-progress
              :percent="realStatus.memUsedPercent"
              :stroke-color="getProgressStrokeColor(realStatus.memUsedPercent)"
              :stroke-width="12"
              :show-info="false"
            />
            <div class="status-bar-value">
              <span class="status-bar-value__percent">{{ realStatus.memUsedPercent }}%</span>
              <span class="status-bar-value__unit"
                >{{ realStatus.memUsedGB }} GB / {{ realStatus.memTotalGB }} GB</span
              >
            </div>
          </div>
        </div>
      </template>
    </template>
  </CardPanel>
</template>

<style lang="scss" scoped>
.status-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;

  &__icon {
    font-size: 18px;
    color: var(--color-primary);
  }

  &__title {
    font-size: var(--font-body);
  }
}

.status-progress {
  margin-bottom: 10px;

  :deep(.ant-progress-inner) {
    border-radius: 6px;
  }
}

.status-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;

  &--wrap {
    margin-top: 4px;
  }

  .status-tag-label {
    margin-right: 4px;
    opacity: 0.9;
  }

  .status-tag-value {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .ant-tag {
    margin: 0;
  }
}

.status-bars {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 4px;

  .status-bar-item {
    .status-bar-label {
      display: inline-block;
      min-width: 36px;
      margin-bottom: 6px;
      color: var(--color-gary-4);
      font-size: 12px;
    }

    :deep(.ant-progress) {
      margin-bottom: 0;

      .ant-progress-outer,
      .ant-progress-inner {
        border-radius: 8px;
      }
    }

    .status-bar-value {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 8px;
      margin-top: 6px;
      font-size: 13px;
      color: var(--color-gary-6);

      &__percent {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }

      &__unit {
        opacity: 0.9;
      }
    }
  }
}

.StatusBlock {
  position: relative;
}
</style>
