import { useEffect, useState } from 'react';
import { App as AntApp, AutoComplete, Form, Input, Modal } from 'antd';
import { useStore } from '../store';

interface FormValues {
  name: string;
  code?: string;
  status?: string;
  description?: string;
}

export default function ProjectEditModal() {
  const open = useStore((state) => state.projectEditOpen);
  const project = useStore((state) => state.project);
  const close = useStore((state) => state.closeProjectEdit);
  const updateProjectMeta = useStore((state) => state.updateProjectMeta);

  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const { message } = AntApp.useApp();

  useEffect(() => {
    if (!open || !project) return;
    form.setFieldsValue({
      name: project.name,
      code: project.code ?? '',
      status: project.status ?? '',
      description: project.description ?? '',
    });
  }, [open, project?.id, form]);

  const submit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSubmitting(true);
    try {
      await updateProjectMeta({
        name: values.name.trim(),
        code: values.code?.trim() ?? '',
        status: values.status?.trim() ?? '',
        description: values.description ?? '',
      });
      message.success('项目信息已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新项目失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!project) return null;

  return (
    <Modal
      open={open}
      onCancel={close}
      onOk={() => void submit()}
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      width={560}
      className="new-task-modal workspace-modal"
      title={
        <span className="modal-title">
          项目信息
          <span className="modal-sub">{project.path}</span>
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
          <Input autoFocus />
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

        <Form.Item
          name="description"
          label="项目简介"
          extra="支持 Markdown；保存后悬停项目名即可查看，留空表示清空。"
        >
          <Input.TextArea
            rows={5}
            maxLength={8000}
            showCount
            placeholder={"例如：**目标**：11 月底完成灰度。\n- 负责人：王伟\n- 风险：依赖外部接口"}
          />
        </Form.Item>

        <div className="form-hint">
          更新 Front Matter；若一级标题与原名一致也会同步。项目文件名和已有链接保持不变。
        </div>
      </Form>
    </Modal>
  );
}
