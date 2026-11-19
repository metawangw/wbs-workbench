import { useEffect, useState } from 'react';
import {
  App as AntApp,
  AutoComplete,
  Form,
  Input,
  Modal,
  Select,
} from 'antd';
import { useStore } from '../store';

interface FormValues {
  name: string;
  code?: string;
  status?: string;
  folder?: string;
}

export default function NewProjectModal() {
  const open = useStore((state) => state.newProjectOpen);
  const presetFolder = useStore((state) => state.newProjectFolder);
  const folders = useStore((state) => state.folders);
  const close = useStore((state) => state.closeNewProject);
  const createProject = useStore((state) => state.createProject);

  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const { message } = AntApp.useApp();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ status: '进行中', folder: presetFolder || '' });
  }, [open, form, presetFolder]);

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
        folder: values.folder ?? '',
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
          <AutoComplete
            options={['进行中', '稳定运营', '已归档'].map((value) => ({
              value,
            }))}
            placeholder="例如：进行中"
            maxLength={40}
            allowClear
          />
        </Form.Item>

        <Form.Item name="folder" label="存放位置">
          <Select
            options={[
              { value: '', label: 'data（根目录）' },
              ...folders.map((folder) => ({ value: folder, label: folder })),
            ]}
            showSearch
            optionFilterProp="label"
            placeholder="根目录"
            allowClear
          />
        </Form.Item>

        <div className="form-hint">
          会在 <code>data/</code> 下创建对应的 <code>.md</code>{' '}
          文件，创建后自动打开项目。
        </div>
      </Form>
    </Modal>
  );
}
