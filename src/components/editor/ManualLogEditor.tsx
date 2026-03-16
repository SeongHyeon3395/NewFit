import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Image } from 'react-native';

import { COLORS, RADIUS, SPACING } from '../../constants/colors';
import { Button } from '../ui/Button';
import { AppIcon } from '../ui/AppIcon';
import { pickPhotoFromCamera } from '../../services/imagePicker';
import { ensureCameraPermissionWithPrompt } from '../../services/permissions';
import type { ManualMealLog } from '../../types/user';
import { useTheme } from '../../theme/ThemeProvider';

type MealType = ManualMealLog['mealType'];

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '아침',
  lunch: '점심',
  dinner: '저녁',
  snack: '간식',
};

function parseNumOrUndefined(s: string): number | undefined {
  const t = String(s ?? '').trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, n);
}

function parseNumOrZero(s: string): number {
  const n = parseNumOrUndefined(s);
  return typeof n === 'number' ? n : 0;
}

export function ManualLogEditor(props: {
  initial: ManualMealLog;
  submitLabel?: string;
  closeLabel?: string;
  onSubmit: (updates: Partial<ManualMealLog>) => void | Promise<void>;
  onClose?: () => void;
}) {
  const { colors } = useTheme();
  const submitLabel = props.submitLabel ?? '저장';
  const closeLabel = props.closeLabel ?? '닫기';

  const [mealType, setMealType] = useState<MealType>(props.initial.mealType);
  const [foodName, setFoodName] = useState(String(props.initial.foodName ?? ''));
  const [photoUri, setPhotoUri] = useState<string>(String(props.initial.imageUri ?? ''));
  const [photoBase64, setPhotoBase64] = useState<string>(String(props.initial.imageBase64 ?? ''));
  const [calories, setCalories] = useState(String(props.initial.calories ?? 0));
  const [carbs, setCarbs] = useState(String(props.initial.carbs_g ?? 0));
  const [protein, setProtein] = useState(String(props.initial.protein_g ?? 0));
  const [fat, setFat] = useState(String(props.initial.fat_g ?? 0));

  const canClose = typeof props.onClose === 'function';

  const capturePhoto = useCallback(async () => {
    const hasCameraPermission = await ensureCameraPermissionWithPrompt();
    if (!hasCameraPermission) return;

    const picked = await pickPhotoFromCamera({ quality: 0.88, includeBase64: true });
    const uri = String(picked?.uri ?? '').trim();
    if (!uri) return;
    setPhotoUri(uri);
    setPhotoBase64(String(picked?.base64 ?? ''));
  }, []);

  const submitUpdates = useMemo<Partial<ManualMealLog>>(
    () => ({
      mealType,
      foodName: foodName.trim() ? foodName.trim() : undefined,
      imageUri: photoUri.trim() ? photoUri.trim() : undefined,
      imageBase64: photoBase64.trim() ? photoBase64.trim() : undefined,
      calories: parseNumOrZero(calories),
      carbs_g: parseNumOrZero(carbs),
      protein_g: parseNumOrZero(protein),
      fat_g: parseNumOrZero(fat),
    }),
    [carbs, calories, fat, foodName, mealType, photoBase64, photoUri, protein]
  );

  return (
    <View style={styles.root}>
      <Text style={styles.fieldLabel}>식사 종류</Text>
      <View style={styles.mealTypeRow}>
        {(Object.keys(MEAL_LABELS) as MealType[]).map(t => (
          <TouchableOpacity
            key={t}
            onPress={() => setMealType(t)}
            style={[
              styles.mealChip,
              { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated },
              mealType === t && styles.mealChipActive,
              mealType === t && { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${MEAL_LABELS[t]} 선택`}
          >
            <Text style={[styles.mealChipText, { color: colors.textSecondary }, mealType === t && styles.mealChipTextActive]}>{MEAL_LABELS[t]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.fieldLabel, { color: colors.text }]}>음식 이름</Text>
      <TextInput
        value={foodName}
        onChangeText={setFoodName}
        placeholder="예: 닭가슴살 샐러드"
        placeholderTextColor={colors.textSecondary}
        style={[styles.input, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated, color: colors.text }]}
      />

      <Text style={[styles.fieldLabel, { color: colors.text }]}>사진</Text>
      <View style={styles.photoRow}>
        <Button
          variant="outline"
          title={photoUri ? '다른 사진으로 바꾸기' : '사진 찍기'}
          onPress={capturePhoto}
          icon={<AppIcon name="photo-camera" size={18} color={colors.text} />}
        />
        {photoUri ? <Image source={{ uri: photoUri }} style={[styles.photoThumb, { borderColor: colors.surfaceMuted }]} /> : <View style={[styles.photoThumbPlaceholder, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated }]} />}
      </View>

      <View style={styles.formGrid}>
        <View style={styles.formField}>
          <Text style={[styles.fieldLabel, { color: colors.text }]}>칼로리(kcal)</Text>
          <TextInput
            value={calories}
            onChangeText={setCalories}
            keyboardType="numeric"
            placeholder="예: 500"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated, color: colors.text }]}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.fieldLabel, { color: colors.text }]}>탄수(g)</Text>
          <TextInput
            value={carbs}
            onChangeText={setCarbs}
            keyboardType="numeric"
            placeholder="예: 60"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated, color: colors.text }]}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.fieldLabel, { color: colors.text }]}>단백질(g)</Text>
          <TextInput
            value={protein}
            onChangeText={setProtein}
            keyboardType="numeric"
            placeholder="예: 30"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated, color: colors.text }]}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.fieldLabel, { color: colors.text }]}>지방(g)</Text>
          <TextInput
            value={fat}
            onChangeText={setFat}
            keyboardType="numeric"
            placeholder="예: 15"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated, color: colors.text }]}
          />
        </View>
      </View>

      <View style={[styles.actionsRow, !canClose && styles.actionsSingle]}>
        <Button
          title={submitLabel}
          onPress={() => props.onSubmit(submitUpdates)}
          style={canClose ? styles.actionHalf : styles.actionFull}
        />
        {canClose ? (
          <Button
            title={closeLabel}
            variant="outline"
            onPress={() => props.onClose?.()}
            style={styles.actionHalf}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: 2,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 14,
  },
  mealTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mealChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  mealChipActive: {
    borderColor: COLORS.blue200,
    backgroundColor: COLORS.blue50,
  },
  mealChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  mealChipTextActive: {
    color: COLORS.primary,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  photoThumb: {
    width: 64,
    height: 64,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.border,
  },
  photoThumbPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  formField: {
    width: '48%',
  },
  actionsRow: {
    marginTop: SPACING.md,
    flexDirection: 'row',
    gap: 8,
  },
  actionsSingle: {
    flexDirection: 'column',
  },
  actionHalf: {
    flex: 1,
  },
  actionFull: {
    width: '100%',
  },
});
