// backend/src/infrastructure/system/__tests__/pathCodec.test.ts
import { describe, it, expect } from 'vitest';
import { encodeProjectPath, toWslPath } from '../pathCodec.js';

describe('encodeProjectPath', () => {
  it('should_encode_windows_path_to_claude_dir_name_when_given_c_drive', () => {
    // 实测自本机 Claude projects 目录
    expect(encodeProjectPath('C:\\Users\\fjyu9\\Desktop\\ai-task-flow'))
      .toBe('C--Users-fjyu9-Desktop-ai-task-flow');
  });

  it('should_encode_wsl_path_to_claude_dir_name_when_given_mnt_form', () => {
    expect(encodeProjectPath('/mnt/c/Users/fjyu9/Desktop/ai-task-flow'))
      .toBe('-mnt-c-Users-fjyu9-Desktop-ai-task-flow');
  });

  it('should_replace_dot_and_colon_when_path_contains_them', () => {
    // . 和 : 也要替换,避免漏编码
    expect(encodeProjectPath('D:\\proj.x')).toBe('D--proj-x');
  });
});

describe('toWslPath', () => {
  it('should_convert_backslash_windows_path_to_mnt_form', () => {
    expect(toWslPath('C:\\Users\\fjyu9\\proj')).toBe('/mnt/c/Users/fjyu9/proj');
  });

  it('should_convert_forward_slash_windows_path_to_mnt_form', () => {
    expect(toWslPath('D:/code/x')).toBe('/mnt/d/code/x');
  });

  it('should_lower_case_the_drive_letter', () => {
    expect(toWslPath('E:\\Repo')).toBe('/mnt/e/Repo');
  });

  it('should_return_as_is_when_already_mnt_form', () => {
    expect(toWslPath('/mnt/c/Users/fjyu9')).toBe('/mnt/c/Users/fjyu9');
  });
});
