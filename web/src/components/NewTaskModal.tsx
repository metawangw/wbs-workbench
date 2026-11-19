import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  AutoComplete,
  Col,
  DatePicker,
  Form,
  Input,
  Modal,
  Row,
  Select,
  TreeSelect,
} from 'antd';
import type { Dayjs } from 'dayjs';
import { collectCodes, priorityMeta, type TaskNode } from '@wbs/shared';
import { useStore } from '../store';
import { IMPORTANCE_OPTIONS } from './atoms';

interface FormValues {
  title: string;
  parentId?: string;
  owner?: string;
  priority?: string;
  importance?: string;
  start?: Dayjs;
  due?: Dayjs;
  cycle?: string;
  confirm?: string;
}

interface ParentOption {
  value: string;
  title: string;
  children?: ParentOption[];
}

function toParentOptions(nodes: TaskNode[], codes: Map<string, string>): ParentOption[] {
  return nodes.map((node) => ({
    value: node.id,
    title: `${codes.get(node.id) ?? ''} ${node.title}`,
    children: node.children.length
      ? toParentOptions(node.children, codes)
      : undefined,
  }));
}

export default function NewTaskModal() {
  const open = useStore((state) => state.createDraft.open);
  const parentId = useStore((state) => state.createDraft.parentId);
  const draftSection = useStore((state) => state.createDraft.section);
  const project = useStore((state) => state.project);
  const closeCreate = useStore((state) => state.closeCreate);
  const createTask = useStore((state) => state.createTask);
  const moveTaskToSection = useStore((state) => state.moveTaskToSection);

  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const { message } = AntApp.useApp();

  const parentOptions = useMemo(() => {
    const roots = project?.roots ?? [];
    return toParentOptions(roots, collectCodes(roots));
  }, [project]);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      parentId: parentId ?? undefined,
      priority: 'P2',
      cycle: '本周',
    });
  }, [open, parentId, draftSection, form]);

  const handleSubmit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSubmitting(true);
    try {
      const fields: Record<string, string> = {};
      const owner = values.owner?.trim();
      const priority = values.priority?.trim();
      const importance = values.importance?.trim();
      const cycle = values.cycle?.trim();
      const confirm = values.confirm?.trim();

      if (owner) fields.owner = owner;
      if (priority) fields.priority = priority;
      if (importance) fields.importance = importance;
      if (values.start) fields.start = values.start.format('YYYY-MM-DD');
      if (values.due) fields.due = values.due.format('YYYY-MM-DD');
      if (cycle) fields.cycle = cycle;
      if (confirm) fields.confirm = confirm;

      const createdId = await createTask({
        parentId: values.parentId ?? null,
        title: values.title.trim(),
        fields,
      });
      // A root task created from a group header should land in that section.
      if (draftSection !== undefined && !values.parentId) {
        await moveTaskToSection(createdId, draftSection);
      }
      message.success('任务已创建');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={closeCreate}
      onOk={() => void handleSubmit()}
      okText="创建任务"
      cancelText="取消"
      confirmLoading={submitting}
      width={620}
      className="new-task-modal"
      title={
        <span className="modal-title">
          新建任务
          <span className="modal-sub">写入 {project?.path ?? 'Markdown 文件'}</span>
        </span>
      }
    >
      <Form form={form} layout="vertical" requiredMark={false} className="task-form">
        <Form.Item
          name="title"
          label="任务名称"
          rules={[
            { required: true, message: '请输入任务名称' },
            { max: 300, message: '最多 300 个字符' },
          ]}
        >
          <Input placeholder="例如：完成登录接口联调" autoFocus />
        </Form.Item>

        <Form.Item name="parentId" label="父任务">
          <TreeSelect
            treeData={parentOptions}
            treeDefaultExpandAll
            showSearch
            allowClear
            treeNodeFilterProp="title"
            placeholder="不选则创建为根任务"
          />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="owner" label="负责人">
              <AutoComplete
                options={(project?.owners ?? []).map((owner) => ({ value: owner }))}
                placeholder="输入或选择负责人"
                allowClear
                filterOption={(input, option) =>
                  String(option?.value ?? '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="priority" label="优先级">
              <Select
                options={['P0', 'P1', 'P2'].map((value) => {
                  const meta = priorityMeta(value);
                  return {
                    value,
                    label: (
                      <span className="select-priority">
                        <span className={`mini-dot ${meta.tone}`} />
                        {meta.label}
                      </span>
                    ),
                  };
                })}
                placeholder="选择优先级"
                allowClear
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="importance" label="重要性">
              <AutoComplete
                options={IMPORTANCE_OPTIONS.map((value) => ({ value }))}
                placeholder="可选（高 / 中 / 低）"
                allowClear
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="start" label="开始日期">
              <DatePicker
                format="YYYY-MM-DD"
                placeholder="甘特图起点"
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="due" label="截止日期">
              <DatePicker
                format="YYYY-MM-DD"
                placeholder="选择日期"
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="cycle" label="周期">
              <AutoComplete
                options={[{ value: '每日' }, { value: '每周' }, { value: '本周' }]}
                placeholder="例如 本周 / 每日"
                allowClear
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="confirm" label="确认人 / 关联人">
              <Input placeholder="例如：李四" allowClear />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
