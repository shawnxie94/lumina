import { ConfigProvider, DatePicker } from "antd";
import type { Dayjs } from "dayjs";
import type { CSSProperties } from "react";

type DateRangeValue = [Dayjs | null, Dayjs | null] | null;

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  placeholder?: [string, string];
  className?: string;
  style?: CSSProperties;
}

export default function DateRangePicker({
  value,
  onChange,
  placeholder = ["开始日期", "结束日期"],
  className,
  style,
}: DateRangePickerProps) {
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
        value={value}
        onChange={onChange}
        className={className}
        size="middle"
        allowClear
        placeholder={placeholder}
        format="YYYY-MM-DD"
        style={{ height: 36, width: "100%", minWidth: 0, ...style }}
      />
    </ConfigProvider>
  );
}
