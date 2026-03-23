import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { COLORS, SPACING, RADIUS } from '../../constants/colors';
import { Card } from '../../components/ui/Card';
import { AppIcon } from '../../components/ui/AppIcon';
import { Button } from '../../components/ui/Button';
import { useAppAlert } from '../../components/ui/AppAlert';
import { useUserStore } from '../../store/userStore';
import { useTheme } from '../../theme/ThemeProvider';

export default function EditAllergensScreen() {
  const navigation = useNavigation();
  const { alert } = useAppAlert();
  const { colors } = useTheme();

  const profile = useUserStore(state => state.profile);
  const updateProfile = useUserStore(state => state.updateProfile);

  const [selectedAllergens, setSelectedAllergens] = useState<string[]>(
    Array.isArray(profile?.allergens) ? profile!.allergens : []
  );
  const [customAllergen, setCustomAllergen] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleAllergen = (allergen: string) => {
    setSelectedAllergens(prev => {
      if (prev.includes(allergen)) return prev.filter(a => a !== allergen);
      return [...prev, allergen];
    });
  };

  const addCustomAllergen = () => {
    const next = customAllergen.trim();
    if (!next) return;
    const normalized = next.toLowerCase();
    setSelectedAllergens(prev => {
      const exists = prev.some(a => a.trim().toLowerCase() === normalized);
      return exists ? prev : [...prev, next];
    });
    setCustomAllergen('');
  };

  const handleSave = async () => {
    if (!profile) {
      alert({ title: '프로필 없음', message: '로그인/온보딩 후 변경할 수 있어요.' });
      return;
    }

    try {
      setSaving(true);
      await updateProfile({ allergens: selectedAllergens });
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <AppIcon name="chevron-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>알레르기 수정</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Card style={styles.card}>
            <View style={styles.titleRow}>
              <View style={[styles.titleIconWrap, { backgroundColor: colors.blue50 }]}>
                <AppIcon name="bolt" size={15} color={colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>직접 추가</Text>
            </View>
            <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>원하는 알레르기 성분을 직접 입력해서 추가하세요.</Text>
            <View style={styles.customInputRow}>
              <TextInput
                style={[styles.customInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.background }]}
                placeholder="예: 땅콩, 우유, 고수"
                placeholderTextColor={colors.textGray}
                value={customAllergen}
                onChangeText={setCustomAllergen}
                returnKeyType="done"
                onSubmitEditing={addCustomAllergen}
              />
              <Button variant="outline" size="sm" onPress={addCustomAllergen}>
                추가
              </Button>
            </View>
          </Card>

          <Card style={styles.card}>
            <View style={styles.titleRow}>
              <View style={[styles.titleIconWrap, { backgroundColor: colors.blue50 }]}>
                <AppIcon name="check-circle" size={15} color={colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>추가된 알레르기 {selectedAllergens.length}개</Text>
            </View>
            <View style={styles.tags}>
              {selectedAllergens.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>아직 추가된 성분이 없어요.</Text>
              ) : (
                selectedAllergens.map((a, idx) => (
                  <TouchableOpacity key={`${a}-${idx}`} style={[styles.tag, { backgroundColor: colors.backgroundGray, borderColor: colors.border }]} onPress={() => toggleAllergen(a)}>
                    <Text style={[styles.tagText, { color: colors.text }]}>{a}</Text>
                    <AppIcon name="close" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))
              )}
            </View>

            <Text style={[styles.removeHint, { color: colors.textGray }]}>태그를 누르면 제거됩니다.</Text>
            <View style={{ height: 12 }} />
            <Button onPress={handleSave} disabled={saving}>
              {saving ? '저장 중...' : '저장'}
            </Button>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  content: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  card: {
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.blue200,
    backgroundColor: COLORS.backgroundGray,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 10,
  },
  sectionDesc: {
    fontSize: 13,
    marginBottom: 12,
    lineHeight: 18,
  },
  customInputRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  customInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: COLORS.blue200,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    color: COLORS.text,
    backgroundColor: COLORS.background,
    fontSize: 14,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.blue200,
  },
  tagText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  removeHint: {
    marginTop: 10,
    fontSize: 11,
  },
});
