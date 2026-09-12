import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { FaqItem, FaqTable, getFaqCategories } from '../content/faq';

export function FaqAccordion() {
  const categories = useMemo(() => getFaqCategories(), []);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <View testID="faq-accordion">
      <Text style={styles.lead}>
        Tap a question. The i next to Risk explains each slider. Legal is the full disclaimer.
      </Text>
      {categories.map((cat) => (
        <View key={cat.id} testID={`faq-category-${cat.id}`} style={styles.category}>
          <Text style={styles.categoryTitle}>{cat.title}</Text>
          {cat.items.map((item) => (
            <FaqRow
              key={item.id}
              item={item}
              open={openId === item.id}
              onToggle={() => setOpenId((cur) => (cur === item.id ? null : item.id))}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function FaqRow({
  item,
  open,
  onToggle,
}: {
  item: FaqItem;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        testID={`faq-q-${item.id}`}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.questionBtn}
      >
        <Text style={styles.question}>{item.q}</Text>
        <Text style={styles.chevron}>{open ? '−' : '+'}</Text>
      </Pressable>
      {open ? (
        <View>
          <Text style={styles.answer} testID={`faq-a-${item.id}`}>
            {item.a}
          </Text>
          {item.table ? <FaqTableView table={item.table} testID={`faq-table-${item.id}`} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function FaqTableView({ table, testID }: { table: FaqTable; testID: string }) {
  return (
    <View style={styles.table} testID={testID}>
      <View style={[styles.tableRow, styles.tableHead]}>
        {table.headers.map((h) => (
          <Text key={h} style={[styles.tableCell, styles.tableHeadText]}>
            {h}
          </Text>
        ))}
      </View>
      {table.rows.map((row) => (
        <View key={row[0]} style={styles.tableRow}>
          {row.map((cell, i) => (
            <Text key={`${row[0]}-${i}`} style={[styles.tableCell, i === 0 && styles.tablePath]}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  lead: {
    color: colors.mute,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: spacing.sm,
  },
  category: { marginBottom: spacing.sm },
  categoryTitle: {
    color: colors.gold,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.2,
    marginBottom: 6,
    marginTop: 4,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 6,
    overflow: 'hidden',
  },
  questionBtn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  question: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    lineHeight: 18,
  },
  chevron: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
  },
  answer: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 10,
    paddingBottom: 12,
  },
  table: {
    marginHorizontal: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tableHead: {
    borderTopWidth: 0,
    backgroundColor: 'rgba(198,167,94,0.12)',
  },
  tableCell: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  tableHeadText: {
    color: colors.gold,
    fontWeight: '800',
  },
  tablePath: {
    color: colors.textPrimary,
    fontWeight: '800',
  },
});
