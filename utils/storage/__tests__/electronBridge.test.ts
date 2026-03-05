
import { ElectronBridge } from '../electronBridge';
import { StorageValidator } from '../validator';

describe('ElectronBridge', () => {
  test('getData returns default value when no data exists', async () => {
    const defaultValue = { test: true };
    const result = await ElectronBridge.getData('test', defaultValue);
    expect(result).toEqual(defaultValue);
  });

  test('setData correctly stores data with version', async () => {
    const testData = { test: true };
    const success = await ElectronBridge.setData('test', testData);
    expect(success).toBe(true);
  });
  
  test('migrations are applied correctly', async () => {
    const oldData = { version: 1, /* ... */ };
    const result = await ElectronBridge.getData('test', oldData);
    expect(result.version).toBe(2);
  });

  test('validation fails for invalid data', async () => {
    const invalidData = { foo: 'bar' };
    const success = await ElectronBridge.setData('test', invalidData);
    expect(success).toBe(false);
  });
});