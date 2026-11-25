import { useEffect, useMemo, useRef, useState } from 'react';
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
  Switch,
  TreeSelect,
} from 'antd';
import type { InputRef } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {
  collectCodes,
  findTask,
  flattenTasks,
  isVersionTask,
  priorityMeta,
  type TaskNode,
} from '@wbs/shared';
import { useStore } from '../store';
import { IMPORTANCE_OPTIONS } from './atoms';

interface FormValues {
  title: string;
  parentId?: string;
  owner?: string[];
  priority?: string;
  importance?: string;
  start?: Dayjs;
  due?: Dayjs;
  cycle?: string;
  confirm?: string;
  created?: Dayjs;
  isTitle?: boolean;
  isVersion?: boolean;
  version?: string;
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

function findTaskTitle(nodes: TaskNode[], id: string): string | undefined {
  for (const node of nodes) {
    if (node.id === id) return node.title;
    const found = findTaskTitle(node.children, id);
    if (found) return found;
  }
  return undefined;
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
  const titleInputRef = useRef<InputRef>(null);
  const { message } = AntApp.useApp();

  const isVersionType = Form.useWatch('isVersion', form) ?? false;
  const versionId = Form.useWatch('version', form) ?? '';

  // 可关联的版本任务；选中后截止日期自动跟随版本且不可改。
  const versionOptions = useMemo(() => {
    const roots = project?.roots ?? [];
    const map = collectCodes(roots);
    return flattenTasks(roots)
      .filter((item) => isVersionTask(item.fields))
      .map((item) => ({
        value: item.id,
        label: `${map.get(item.id) ?? ''} ${item.title}`.trim(),
        due: item.fields.due ?? '',
      }));
  }, [project]);

  const parentOptions = useMemo(() => {
    const roots = project?.roots ?? [];
    return toParentOptions(roots, collectCodes(roots));
  }, [project]);

  const parentTitle = useMemo(
    () => (parentId ? findTaskTitle(project?.roots ?? [], parentId) : undefined),
    [parentId, project],
  );

  // 从"添加子任务"（任务前的 + 号）进来的子任务，默认继承父任务优先级。
  const defaultPriority = useMemo(() => {
    if (!parentId) return 'P2';
    const parent = findTask(project?.roots ?? [], parentId);
    return parent?.fields.priority?.trim() || 'P2';
  }, [parentId, project]);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const parent = parentId ? findTask(project?.roots ?? [], parentId) : undefined;
    const inheritVersion =
      parent && isVersionTask(parent.fields) ? parent.id : undefined;
    form.setFieldsValue({
      parentId: parentId ?? undefined,
      priority: defaultPriority,
      created: dayjs(),
      isTitle: false,
      isVersion: false,
      version: inheritVersion,
      due: inheritVersion
        ? versionOptions.find((item) => item.value === inheritVersion)?.due
          ? dayjs(versionOptions.find((item) => item.value === inheritVersion)!.due)
          : undefined
        : undefined,
    });
  }, [open, parentId, draftSection, defaultPriority, form, project]);

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
      const owner = values.owner?.filter(Boolean).join('、').trim();
      const priority = values.priority?.trim();
      const importance = values.importance?.trim();
      const cycle = values.cycle?.trim();
      const confirm = values.confirm?.trim();

      if (owner) fields.owner = owner;
      if (priority) fields.priority = priority;
      if (importance) fields.importance = importance;
      if (values.start) fields.start = values.start.format('YYYY-MM-DD');
      if (values.due) fields.due = values.due.format('YYYY-MM-DD');
      if (values.created) fields.created = values.created.format('YYYY-MM-DD');
      if (values.isTitle) fields.isTitle = '1';
      if (values.isVersion) fields.isVersion = '1';
      if (values.version && !values.isVersion) fields.version = values.version;
      if (cycle) fields.cycle = cycle;
      if (confirm) fields.confirm = confirm;
      // 关联版本时截止日期交给服务端按版本回填。
      if (values.version) delete fields.due;

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
      afterOpenChange={(value) => {
        // Modal 动画结束后把光标放回任务名称，避免被 Switch 等控件抢走焦点。
        if (value) window.setTimeout(() => titleInputRef.current?.focus(), 60);
      }}
      title={
        <span className="modal-title">
          新建任务
          <span className="modal-sub">
            {parentTitle ? `父任务：${parentTitle}` : `写入 ${project?.path ?? 'Markdown 文件'}`}
          </span>
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
          <Input
            ref={titleInputRef}
            placeholder="例如：完成登录接口联调"
            autoFocus
            // 输完名字直接回车就建，不用再去点「创建任务」。
            onPressEnter={(event) => {
              if ((event.nativeEvent as KeyboardEvent).isComposing) return;
              void handleSubmit();
            }}
          />
        </Form.Item>

        <Form.Item name="version" label="所属版本">
          <Select
            options={versionOptions}
            placeholder={
              versionOptions.length
                ? '不选则截止日期可自由填写'
                : '还没有版本任务，可先把某个任务改成版本类型'
            }
            allowClear
            showSearch
            optionFilterProp="label"
            disabled={isVersionType}
            onChange={(value?: string) => {
              const due = versionOptions.find((item) => item.value === value)?.due;
              form.setFieldValue('due', value && due ? dayjs(due) : undefined);
            }}
          />
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
            <Form.Item name="owner" label="联系人">
              <Select
                mode="tags"
                options={(project?.owners ?? []).map((owner) => ({
                  value: owner,
                  label: owner,
                }))}
                placeholder="输入或选择联系人，可填多个"
                allowClear
                tokenSeparators={[',', '，', '、']}
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
                placeholder={versionId ? '跟随所属版本' : '选择日期'}
                style={{ width: '100%' }}
                disabled={Boolean(versionId)}
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
          <Col span={12}>
            <Form.Item name="created" label="创建日期">
              <DatePicker
                format="YYYY-MM-DD"
                placeholder="选择或输入日期"
                style={{ width: '100%' }}
                allowClear
              />
            </Form.Item>
          </Col>
        </Row>

        <div className="task-form-switches">
          <div className="task-form-switch">
            <Form.Item name="isTitle" valuePropName="checked" noStyle>
              <Switch
                size="small"
                onChange={(value) => {
                  if (value) form.setFieldValue('isVersion', false);
                }}
              />
            </Form.Item>
            <span>标题类型</span>
          </div>
          <div className="task-form-switch">
            <Form.Item name="isVersion" valuePropName="checked" noStyle>
              <Switch
                size="small"
                onChange={(value) => {
                  if (value) {
                    form.setFieldValue('isTitle', false);
                    form.setFieldValue('version', undefined);
                  }
                }}
              />
            </Form.Item>
            <span>版本类型</span>
          </div>
        </div>
      </Form>
    </Modal>
  );
}
