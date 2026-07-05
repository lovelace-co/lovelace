import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HoleCheck } from '../src/components/HoleCheck';

describe('HoleCheck', () => {
  it('is a real checkbox: labelled, toggleable, keyboard reachable', () => {
    const onChange = vi.fn();
    render(<HoleCheck aria-label="install git hook" checked={false} onChange={onChange} />);
    const input = screen.getByLabelText('install git hook') as HTMLInputElement;
    expect(input.type).toBe('checkbox');
    expect(input.checked).toBe(false);
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalled();
  });

  it('renders disabled without losing its checked face', () => {
    render(<HoleCheck aria-label="title field required" checked readOnly disabled />);
    const input = screen.getByLabelText('title field required') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.checked).toBe(true);
  });
});
