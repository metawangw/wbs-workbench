import { useEffect, useState } from 'react';
import { App as AntApp, Form, Input, Modal } from 'antd';
import { useStore } from '../store';

interface FormValues {
  folder: string;
}

export default function NewFolderModal() {
  const open = useStore((state) => state.newFolderOpen);
  const close = useStore((state) => state.closeNewFolder);
  const createFolder = useStore((state) => state.createFolder);

  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const { message } = AntApp.useApp();

  useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  const submit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSubmitting(true);
    try {
      const folder = await createFolder(values.folder.trim());
      message.success(`文件夹「${folder}」已创建`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建文件夹失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      onOk={() => void submit()}
      okText="创建文件夹"
      cancelText="取消"
      confirmLoading={submitting}
      width={480}
      className="new-task-modal workspace-modal"
      title={
        <span className="modal-title">
          新建文件夹
          <span className="modal-sub">在 data 目录下创建分组</span>
        </span>
      }
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="folder"
          label="文件夹路径"
          rules={[
            { required: true, message: '请输入文件夹名称' },
            {
              validator: (_, value: string) => {
                if (!value) return Promise.resolve();
                if (value.split(/[\\/]/).some((part) => part.trim() === '..')) {
                  return Promise.reject(new Error('路径不能包含 ..'));
                }
                if (/[<>:"|?*]/.test(value)) {
                  return Promise.reject(new Error('名称包含非法字符'));
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <Input
            placeholder="例如：客户项目，或 2026/Q4"
            autoFocus
            onPressEnter={() => void submit()}
          />
        </Form.Item>

        <div className="form-hint">
          支持多级路径。文件夹会立即出现在左侧导航中，可容纳新建或手工放入的项目。
        </div>
      </Form>
    </Modal>
  );
}
