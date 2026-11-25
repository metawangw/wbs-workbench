import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, Spin } from 'antd';
import { ArrowUpOutlined, FolderOutlined, HddOutlined } from '@ant-design/icons';
import { api, type DirListing } from '../api';

interface Props {
  open: boolean;
  /** Directory the browser should open at; falls back to drive roots if invalid. */
  initialPath: string;
  onCancel: () => void;
  onPick: (dirPath: string) => void;
}

/**
 * In-app directory browser used by the settings dialog.
 *
 * The app is started from a hidden launcher, so a system folder dialog cannot be
 * reliably surfaced from the background service. Listing directories through the
 * local API gives the same result without depending on the desktop session.
 *
 * A drive root has no parent directory server-side (`parent: null`), so the
 * visited paths are kept in a small stack: that is what lets 「上一级」 walk back
 * out of e.g. `E:\` and reach the drive list again.
 */
export default function DirPicker({ open, initialPath, onCancel, onPick }: Props) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [current, setCurrent] = useState('');
  const [trail, setTrail] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  const initialRef = useRef(initialPath);
  initialRef.current = initialPath;

  const load = useCallback(
    async (target: string, fallbackToRoots = false): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.listDirs(target);
        setListing(data);
        setCurrent(data.path);
        setTyped(data.path);
      } catch (err) {
        if (fallbackToRoots && target) {
          // Stale or unreadable start path: fall back to the drive list.
          setLoading(false);
          await load('', false);
          return;
        }
        setListing(null);
        setCurrent(target);
        setTyped(target);
        setError(err instanceof Error ? err.message : '无法读取该目录');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      setListing(null);
      setError(null);
      setTrail([]);
      return;
    }
    setTrail([]);
    void load(initialRef.current.trim(), true);
  }, [open, load]);

  const atRoots = listing !== null && listing.path === '';
  const canGoUp = trail.length > 0 || (listing !== null && listing.path !== '');

  const enter = (dirPath: string) => {
    setTrail((prev) => [...prev, current]);
    void load(dirPath);
  };

  const goRoots = () => {
    setTrail([]);
    void load('');
  };

  const goUp = () => {
    if (trail.length > 0) {
      const previous = trail[trail.length - 1];
      setTrail((prev) => prev.slice(0, -1));
      void load(previous);
      return;
    }
    if (listing?.parent) {
      void load(listing.parent);
      return;
    }
    if (listing?.path) {
      goRoots();
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="选择数据目录"
      width={540}
      className="dir-picker"
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button
          key="pick"
          type="primary"
          disabled={!listing || atRoots}
          onClick={() => onPick(current)}
        >
          选择此目录
        </Button>,
      ]}
    >
      <div className="dir-picker-bar">
        <Button size="small" icon={<ArrowUpOutlined />} disabled={!canGoUp} onClick={goUp}>
          上一级
        </Button>
        <Button size="small" icon={<HddOutlined />} disabled={atRoots} onClick={goRoots}>
          磁盘
        </Button>
        <Input
          className="dir-picker-path"
          size="small"
          value={typed}
          placeholder="选择磁盘或输入路径后回车"
          onChange={(event) => setTyped(event.target.value)}
          onPressEnter={() => {
            setTrail((prev) => [...prev, current]);
            void load(typed.trim(), false);
          }}
        />
      </div>

      <div className="dir-picker-list">
        {loading ? (
          <div className="dir-picker-hint">
            <Spin size="small" />
            <span>读取目录…</span>
          </div>
        ) : error ? (
          <div className="dir-picker-hint is-error">{error}</div>
        ) : listing && listing.dirs.length === 0 ? (
          <div className="dir-picker-hint">
            <FolderOutlined />
            <span>该目录下没有子文件夹，可点「上一级」切换位置</span>
          </div>
        ) : (
          (listing?.dirs ?? []).map((dir) => (
            <div className="dir-picker-row" key={dir.path}>
              <button
                type="button"
                className="dir-picker-item"
                onClick={() => enter(dir.path)}
              >
                {atRoots ? <HddOutlined /> : <FolderOutlined />}
                <span className="dir-picker-name">{dir.name}</span>
              </button>
              {atRoots ? (
                <button
                  type="button"
                  className="dir-picker-pick"
                  onClick={() => onPick(dir.path)}
                >
                  选择此磁盘
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="dir-picker-foot">
        当前：<span className="dir-picker-now">{atRoots ? '（选择磁盘）' : current || '—'}</span>
      </div>
    </Modal>
  );
}
