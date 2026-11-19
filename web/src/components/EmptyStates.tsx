import { Button } from 'antd';
import {
  FileSearchOutlined,
  ReloadOutlined,
  RocketOutlined,
} from '@ant-design/icons';

export function NoMatches({ onReset }: { onReset: () => void }) {
  return (
    <div className="empty-block">
      <div className="empty-icon">
        <FileSearchOutlined />
      </div>
      <h3>没有符合条件的任务</h3>
      <p>尝试放宽筛选条件，或清空搜索关键词。</p>
      <Button onClick={onReset}>清除筛选</Button>
    </div>
  );
}

export function Onboarding({
  dataDir,
  onRefresh,
}: {
  dataDir: string;
  onRefresh: () => void;
}) {
  return (
    <div className="onboarding">
      <div className="onboarding-mark">
        <RocketOutlined />
      </div>
      <h2>从一份 Markdown 开始</h2>
      <p className="onboarding-lead">
        WBS 工作台直接读取本地文件，没有数据库，也没有导入步骤。在数据目录里放一个
        <code>.md</code> 文件，项目就会出现在左侧。
      </p>

      <div className="onboarding-steps">
        <div className="onboarding-step">
          <span className="step-index">01</span>
          <div>
            <strong>打开数据目录</strong>
            <code className="step-path">{dataDir || './data'}</code>
          </div>
        </div>
        <div className="onboarding-step">
          <span className="step-index">02</span>
          <div>
            <strong>新建项目文件</strong>
            <p>文件名即项目入口，Front Matter 提供项目元数据。</p>
          </div>
        </div>
        <div className="onboarding-step">
          <span className="step-index">03</span>
          <div>
            <strong>点击重新扫描</strong>
            <p>之后在界面中的修改会自动写回同一份文件。</p>
          </div>
        </div>
      </div>

      <pre className="onboarding-sample">{`---
project: 我的项目
code: PRJ-001
status: 进行中
---

# 我的项目

- [ ] 第一个任务 [owner::我] [priority::P1] [due::2026-12-01] <!-- id:t_demo01 -->`}</pre>

      <Button type="primary" icon={<ReloadOutlined />} onClick={onRefresh}>
        重新扫描
      </Button>
    </div>
  );
}
