import { PARAMS, PARAM_GROUPS, type Params } from '../sim/params.ts';

const DEFAULTS: Params = { ...PARAMS };

/**
 * Live editor over PARAMS. Every knob is applied on input with no restart —
 * this is where the balance actually gets found, so it is deliberately the
 * least decorated and most direct piece of UI in the build.
 */
export function createDevPanel(onChange: () => void): void {
  const root = document.getElementById('devpanel')!;

  const head = document.createElement('div');
  head.className = 'dp-head';
  head.innerHTML = '<span>PARAMETERS</span><span class="tog">–</span>';
  root.appendChild(head);

  const body = document.createElement('div');
  body.className = 'dp-body';
  root.appendChild(body);

  const inputs = new Map<keyof Params, HTMLInputElement>();

  for (const group of PARAM_GROUPS) {
    const g = document.createElement('div');
    g.className = 'grp';
    g.textContent = group.label;
    body.appendChild(g);
    for (const key of group.keys) {
      const label = document.createElement('label');
      const span = document.createElement('span');
      span.textContent = key.replace(/_/g, ' ').toLowerCase();
      span.title = key;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = String(stepFor(DEFAULTS[key]));
      input.value = String(PARAMS[key]);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        if (Number.isFinite(v)) {
          PARAMS[key] = v;
          onChange();
        }
      });
      inputs.set(key, input);
      label.append(span, input);
      body.appendChild(label);
    }
  }

  const foot = document.createElement('div');
  foot.className = 'dp-foot';
  const reset = document.createElement('button');
  reset.textContent = 'RESET';
  reset.addEventListener('click', () => {
    for (const [key, input] of inputs) {
      PARAMS[key] = DEFAULTS[key];
      input.value = String(DEFAULTS[key]);
    }
    onChange();
  });
  const copy = document.createElement('button');
  copy.textContent = 'COPY';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(JSON.stringify(PARAMS, null, 2));
    copy.textContent = 'COPIED';
    setTimeout(() => (copy.textContent = 'COPY'), 900);
  });
  foot.append(reset, copy);
  root.appendChild(foot);

  head.addEventListener('click', () => {
    root.classList.toggle('collapsed');
    head.querySelector('.tog')!.textContent = root.classList.contains('collapsed') ? '+' : '–';
  });
  root.classList.add('collapsed');
  head.querySelector('.tog')!.textContent = '+';
}

function stepFor(v: number): number {
  const a = Math.abs(v);
  if (a < 0.05) return 0.001;
  if (a < 1) return 0.01;
  if (a < 20) return 0.1;
  if (a < 500) return 1;
  return 50;
}
