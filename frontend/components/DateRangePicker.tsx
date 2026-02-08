import { ConfigProvider, DatePicker } from "antd";
import type { Dayjs } from "dayjs";
import type { CSSProperties } from "react";
import { useI18n } from "@/lib/i18n";

type DateRangeValue = [Dayjs | null, Dayjs | null] | null;

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  placeholder?: [string, string];
  className?: string;
  style?: CSSProperties;
  id?: string;
}

export default function DateRangePicker({
  value,
  onChange,
  placeholder,
  className,
  style,
  id,
}: DateRangePickerProps) {
  const { t } = useI18n();
  const resolvedPlaceholder = placeholder || [t("开始日期"), t("结束日期")];

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#3B82F6",
          borderRadius: 4,
          fontSize: 14,
          controlHeight: 36,
        },
      }}
    >
      <DatePicker.RangePicker
        id={id}
        value={value}
        onChange={onChange}
        className={className}
        size="middle"
        allowClear
        placeholder={resolvedPlaceholder}
        format="YYYY-MM-DD"
        style={{ height: 36, width: "100%", minWidth: 0, ...style }}
      />
    </ConfigProvider>
  );
}
