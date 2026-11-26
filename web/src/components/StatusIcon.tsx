/**
 * 项目状态前置图标。图形全部为内联 SVG，颜色统一走 currentColor，
 * 因此只由状态配置里的自定义颜色决定，不额外引入色板。
 */
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { projectStatusColor, projectStatusIcon } from '../lib/settings';

interface StatusIconProps {
  /** PROJECT_STATUS_ICONS 中的 key。 */
  icon?: string;
  /** 状态自定义色。 */
  color: string;
  /** 小字号下的基准尺寸（px）；实际尺寸随 --fs-bump 一起放大。 */
  size?: number;
  className?: string;
  title?: string;
}

const RING_RADIUS = 6.6;

function outline(dashed = false): ReactNode {
  return (
    <circle
      cx="10"
      cy="10"
      r={RING_RADIUS}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeDasharray={dashed ? '2.6 2' : undefined}
    />
  );
}

function shape(icon: string): ReactNode {
  switch (icon) {
    case 'dot':
      return <circle cx="10" cy="10" r="6.6" fill="currentColor" />;
    case 'ring':
      return outline();
    case 'ringDot':
      return (
        <>
          {outline()}
          <circle cx="10" cy="10" r="2.2" fill="currentColor" />
        </>
      );
    case 'dashed':
      return (
        <>
          {outline(true)}
          <circle cx="10" cy="10" r="2" fill="currentColor" />
        </>
      );
    case 'half':
      return (
        <>
          <circle
            cx="10"
            cy="10"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
          />
          <path d="M10 10 L10 3.4 A6.6 6.6 0 0 0 10 16.6 Z" fill="currentColor" />
        </>
      );
    case 'threeQuarter':
      return (
        <>
          <circle
            cx="10"
            cy="10"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
          />
          <path d="M10 10 L10 3.4 A6.6 6.6 0 1 0 16.6 10 Z" fill="currentColor" />
        </>
      );
    case 'check':
      return (
        <>
          <circle cx="10" cy="10" r="7.2" fill="currentColor" />
          <path
            d="M6.5 10.2 L8.8 12.5 L13.6 7.6"
            fill="none"
            stroke="#fff"
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case 'pause':
      return (
        <>
          <circle cx="10" cy="10" r="7.2" fill="currentColor" />
          <path
            d="M8 7.4 V12.6 M12 7.4 V12.6"
            fill="none"
            stroke="#fff"
            strokeWidth={1.9}
            strokeLinecap="round"
          />
        </>
      );
    case 'slash':
      return (
        <>
          <circle cx="10" cy="10" r="7.2" fill="currentColor" />
          <path
            d="M7 7 L13 13"
            fill="none"
            stroke="#fff"
            strokeWidth={1.9}
            strokeLinecap="round"
          />
        </>
      );
    case 'square':
      return <rect x="3.6" y="3.6" width="12.8" height="12.8" rx="2.4" fill="currentColor" />;
    case 'diamond':
      return <path d="M10 3.2 L16.8 10 L10 16.8 L3.2 10 Z" fill="currentColor" />;
    case 'hexagon':
      return (
        <path
          d="M10 3 L16 6.5 V13.5 L10 17 L4 13.5 V6.5 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      );
    case 'flag':
      return (
        <path
          d="M5.4 3.4 V16.6 M5.4 4 H15.6 L13 7 L15.6 10 H5.4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'bolt':
      return <path d="M11.4 3 L6.3 11 H9.5 L8.7 17 L13.9 8.6 H10.6 Z" fill="currentColor" />;
    case 'star':
      return (
        <path
          d="M10 2.8 L12.1 8 L17.6 8.6 L13.4 12.3 L14.7 17.7 L10 14.7 L5.3 17.7 L6.6 12.3 L2.4 8.6 L7.9 8 Z"
          fill="currentColor"
        />
      );
    case 'clock':
      return (
        <>
          {outline()}
          <path
            d="M10 6 V10.2 L12.8 11.8"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case 'archive':
      return (
        <>
          <rect
            x="3.4"
            y="6"
            width="13.2"
            height="10.6"
            rx="1.8"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
          />
          <path
            d="M3 6 H17 M7.6 9.8 H12.4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </>
      );
    case 'target':
      return (
        <>
          {outline()}
          <circle cx="10" cy="10" r="3.2" fill="none" stroke="currentColor" strokeWidth={1.6} />
          <circle cx="10" cy="10" r="1.2" fill="currentColor" />
        </>
      );
    default:
      return outline();
  }
}

export default function StatusIcon({
  icon,
  color,
  size = 14,
  className,
  title,
}: StatusIconProps) {
  const iconSize = `calc(${size}px + var(--fs-bump))`;
  return (
    <svg
      className={`status-icon${className ? ` ${className}` : ''}`}
      viewBox="0 0 20 20"
      role={title ? 'img' : undefined}
      aria-label={title}
      style={{ color, width: iconSize, height: iconSize } as CSSProperties}
    >
      {shape(icon ?? 'ring')}
    </svg>
  );
}

/** 按项目状态名解析图标与颜色，供项目栏等位置直接使用。 */
export function ProjectStatusIcon({
  status,
  size = 14,
  className,
}: {
  status?: string;
  size?: number;
  className?: string;
}) {
  const statuses = useStore((state) => state.statuses);
  return (
    <StatusIcon
      icon={projectStatusIcon(status, statuses)}
      color={projectStatusColor(status, statuses)}
      size={size}
      className={className}
      title={status || undefined}
    />
  );
}
