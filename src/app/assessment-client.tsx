"use client";

import React, { FormEvent, useEffect, useState } from "react";

type Step = "gender" | "goal" | "body" | "activity";
type Answers = {
  gender: "male" | "female";
  goal: "lose" | "maintain" | "gain";
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  activityLevel: "sedentary" | "light" | "moderate" | "active" | "very_active";
};

type Progress = {
  id: string;
  version: number;
  currentStep: Step | null;
  progressPercent: number;
  readyToSubmit: boolean;
  status: "DRAFT" | "COMPLETED";
  answers: Partial<Record<Step, { payload: Partial<Answers> }>>;
};

type Result = {
  access: "preview" | "premium";
  bmi: number;
  bmiCategory: string;
  summary?: string;
  recommendedDailyCalories?: number;
  estimatedTargetDate?: string | null;
  weeklyWeightChangeKg?: number;
  disclaimer: string;
};

const steps: Step[] = ["gender", "goal", "body", "activity"];
const labels: Record<Step, string> = {
  gender: "关于你",
  goal: "你的目标",
  body: "身体信息",
  activity: "活动水平",
};
const choiceLabels: Record<string, string> = {
  female: "女",
  male: "男",
  lose: "减脂",
  maintain: "保持",
  gain: "增肌",
  sedentary: "久坐",
  light: "轻度",
  moderate: "中度",
  active: "活跃",
  very_active: "非常活跃",
};
const bmiCategoryLabels: Record<string, string> = {
  underweight: "偏瘦",
  normal: "正常",
  overweight: "超重",
  obese: "肥胖",
};
const defaults: Answers = {
  gender: "female",
  goal: "lose",
  age: 30,
  heightCm: 165,
  weightKg: 70,
  targetWeightKg: 63,
  activityLevel: "moderate",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "Request failed");
  return payload.data as T;
}

export default function AssessmentClient() {
  const [sessionId, setSessionId] = useState("");
  const [version, setVersion] = useState(0);
  const [step, setStep] = useState<Step>("gender");
  const [answers, setAnswers] = useState(defaults);
  const [result, setResult] = useState<Result | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const savedId = localStorage.getItem("health-path-session");
        let progress: Progress;
        if (savedId) {
          try {
            progress = await api<Progress>(`/api/sessions/${savedId}`);
          } catch {
            localStorage.removeItem("health-path-session");
            progress = await api<Progress>("/api/sessions", { method: "POST" });
          }
        } else {
          progress = await api<Progress>("/api/sessions", { method: "POST" });
        }
        localStorage.setItem("health-path-session", progress.id);
        setSessionId(progress.id);
        setVersion(progress.version);
        const restored = Object.values(progress.answers).reduce(
          (all, answer) => ({ ...all, ...answer?.payload }),
          defaults,
        );
        setAnswers(restored);
        setStep(progress.currentStep ?? "activity");
        if (progress.status === "COMPLETED") {
          setResult(await api<Result>(`/api/sessions/${progress.id}/result`));
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "无法启动评估");
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const update = (field: keyof Answers, value: string | number) => {
    setAnswers((current) => ({ ...current, [field]: value }));
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = step === "gender"
        ? { gender: answers.gender }
        : step === "goal"
          ? { goal: answers.goal }
          : step === "body"
            ? { age: answers.age, heightCm: answers.heightCm, weightKg: answers.weightKg, targetWeightKg: answers.targetWeightKg }
            : { activityLevel: answers.activityLevel };
      const progress = await api<Progress>(`/api/sessions/${sessionId}/steps/${step}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data, expectedVersion: version }),
      });
      setVersion(progress.version);
      if (progress.readyToSubmit) {
        await api(`/api/sessions/${sessionId}/submit`, { method: "POST" });
        setResult(await api<Result>(`/api/sessions/${sessionId}/result`));
      } else {
        setStep(progress.currentStep ?? step);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存本步骤失败");
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    setBusy(true);
    setError("");
    try {
      await api("/pay", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({
          eventId: `demo_${Date.now()}`,
          sessionId,
          status: "paid",
        }),
      });
      setResult(await api<Result>(`/api/sessions/${sessionId}/result`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "解锁失败");
    } finally {
      setBusy(false);
    }
  }

  if (busy && !sessionId) return <p className="status">正在准备评估…</p>;

  if (result) {
    return (
      <section className="result-card" aria-live="polite">
        <p className="eyebrow">评估结果</p>
        <h2>BMI {result.bmi}</h2>
        <p className="category">{bmiCategoryLabels[result.bmiCategory] ?? result.bmiCategory}</p>
        {result.access === "premium" ? (
          <div className="metrics">
            <div><strong>{result.recommendedDailyCalories}</strong><span>每日建议热量（千卡）</span></div>
            <div><strong>{result.weeklyWeightChangeKg} 千克</strong><span>每周变化</span></div>
            <div><strong>{result.estimatedTargetDate ?? "保持中"}</strong><span>预计达成日期</span></div>
          </div>
        ) : (
          <div className="locked">
            <p>{result.summary}</p>
            <h3>解锁完整评估</h3>
            <label>本地演示支付密钥<input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} /></label>
            <button type="button" onClick={unlock} disabled={busy || secret.length < 24}>模拟支付并解锁</button>
          </div>
        )}
        <p className="notice">{result.disclaimer}</p>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    );
  }

  const index = steps.indexOf(step);
  return (
    <section className="quiz-card">
      <div className="progress"><span style={{ width: `${(index / steps.length) * 100}%` }} /></div>
      <p className="step-count">第 {index + 1} 步 / 共 {steps.length} 步</p>
      <h2>{labels[step]}</h2>
      <form onSubmit={save}>
        {step === "gender" && <Choice name="gender" value={answers.gender} onChange={(value) => update("gender", value)} options={["female", "male"]} />}
        {step === "goal" && <Choice name="goal" value={answers.goal} onChange={(value) => update("goal", value)} options={["lose", "maintain", "gain"]} />}
        {step === "body" && <div className="field-grid">
          <NumberField label="年龄" value={answers.age} min={18} max={80} onChange={(value) => update("age", value)} />
          <NumberField label="身高（厘米）" value={answers.heightCm} min={120} max={230} onChange={(value) => update("heightCm", value)} />
          <NumberField label="当前体重（千克）" value={answers.weightKg} min={35} max={300} onChange={(value) => update("weightKg", value)} />
          <NumberField label="目标体重（千克）" value={answers.targetWeightKg} min={35} max={300} onChange={(value) => update("targetWeightKg", value)} />
        </div>}
        {step === "activity" && <Choice name="activity" value={answers.activityLevel} onChange={(value) => update("activityLevel", value)} options={["sedentary", "light", "moderate", "active", "very_active"]} />}
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={busy}>{step === "activity" ? "查看我的评估" : "下一步"}</button>
      </form>
    </section>
  );
}

function Choice({ name, value, options, onChange }: { name: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <div className="choices">{options.map((option) => <label key={option} className={value === option ? "selected" : ""}><input type="radio" name={name} checked={value === option} onChange={() => onChange(option)} /><span>{choiceLabels[option] ?? option.replace("_", " ")}</span></label>)}</div>;
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label>{label}<input type="number" required min={min} max={max} step="0.1" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
