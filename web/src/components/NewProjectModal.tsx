import { useEffect, useState } from 'react';
import { App as AntApp, Form, Input, Modal } from 'antd';
import { useStore } from '../store';
import StatusSelect from './StatusSelect';

interface FormValues {
  name: string;
  code?: string;
  status?: string;
}

export default function NewProjectModal() {
  const open = useStore((state) => state.newProjectOpen);
  const presetFolder = useStore((state) => state.newProjectFolder);
  const dataDir = useStore((state) => state.dataDir);
  const close = useStore((state) => state.closeNewProject);
  const createProject = useStore((state) => state.createProject);
  const statuses = useStore((state) => state.statuses);

  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const { message } = AntApp.useApp();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const presetStatus =
      statuses.find((status) => status.name === '进行中')?.name ?? statuses[0]?.name ?? '';
    form.setFieldsValue({ status: presetStatus });
  }, [open, form, presetFolder, statuses]);

  const submit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSubmitting(true);
    try {
      await createProject({
        name: values.name.trim(),
        code: values.code?.trim(),
        status: values.status?.trim(),
        // 从文件夹入口打开时沿用预置目录；否则留在项目根目录。
        folder: presetFolder,
      });
      message.success('项目已创建');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建项目失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      onOk={() => void submit()}
      okText="创建项目"
      cancelText="取消"
      confirmLoading={submitting}
      width={560}
      className="new-task-modal workspace-modal"
      title={
        <span className="modal-title">
          新建项目
          <span className="modal-sub">创建一份 Markdown 项目文件</span>
        </span>
      }
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="name"
          label="项目名称"
          rules={[
            { required: true, message: '请输入项目名称' },
            { max: 100, message: '最多 100 个字符' },
          ]}
        >
          <Input placeholder="例如：支付中台重构" autoFocus />
        </Form.Item>

        <Form.Item name="code" label="项目编号">
          <Input placeholder="例如：PRJ-2026-001" maxLength={60} />
        </Form.Item>

        <Form.Item name="status" label="项目状态">
          <StatusSelect />
        </Form.Item>

        <div className="form-hint">
          会在{' '}
          <code>{presetFolder ? `${presetFolder}/` : `${dataDir || 'data'}/`}</code>{' '}
          下创建对应的 <code>.md</code> 文件，创建后自动打开项目。
        </div>
      </Form>
    </Modal>
  );
}
