import { useState } from 'react';
import {
  Alert,
  Badge,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconCheck, IconStar, IconStarFilled } from '@tabler/icons-react';
import type { ProtocolName } from '../lib/api';
import { recipesForProtocol, type Recipe } from '../lib/recipes';

interface Props {
  protocol: ProtocolName;
  onPick: (recipe: Recipe) => void;
}

/**
 * Recipe gallery shown above the protocol-specific config block in
 * ProfileFormModal. One click pre-fills a known-good combo so admins
 * don't need to reason about REALITY/Vision/transport compatibility
 * matrices themselves.
 *
 * The chosen recipe stays highlighted but doesn't lock the form — admins
 * can still tweak individual fields after applying.
 */
export function RecipePicker({ protocol, onPick }: Props) {
  const recipes = recipesForProtocol(protocol);
  const [picked, setPicked] = useState<string | null>(null);

  if (recipes.length === 0) {
    return (
      <Alert color="gray" variant="light">
        Для этого протокола рецептов пока нет — заполни поля ниже вручную.
      </Alert>
    );
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="flex-end">
        <Stack gap={0}>
          <Text fw={600} size="sm">
            Рецепты быстрой настройки
          </Text>
          <Text size="xs" c="dimmed">
            Клик — поля ниже заполнятся под выбранный сценарий. Ручная правка
            остаётся доступной.
          </Text>
        </Stack>
        {picked && (
          <Badge variant="light" color="teal" leftSection={<IconCheck size={11} />}>
            Recipe применён
          </Badge>
        )}
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
        {recipes.map((r) => (
          <RecipeCard
            key={r.id}
            recipe={r}
            active={picked === r.id}
            onClick={() => {
              setPicked(r.id);
              onPick(r);
            }}
          />
        ))}
      </SimpleGrid>

      {picked && (
        <Alert color="teal" variant="light" icon={<IconCheck size={16} />}>
          {recipes.find((r) => r.id === picked)?.notes?.length ? (
            <Stack gap={4}>
              <Text size="xs" fw={500}>
                Применён: {recipes.find((r) => r.id === picked)?.name}
              </Text>
              {recipes
                .find((r) => r.id === picked)
                ?.notes?.map((n, i) => (
                  <Text key={i} size="xs">
                    • {n}
                  </Text>
                ))}
            </Stack>
          ) : (
            <Text size="xs">
              Применён: {recipes.find((r) => r.id === picked)?.name}.
              Поля заполнены — можно сохранять или подкрутить детали ниже.
            </Text>
          )}
        </Alert>
      )}
    </Stack>
  );
}

function RecipeCard({
  recipe,
  active,
  onClick,
}: {
  recipe: Recipe;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip
      label={recipe.details}
      multiline
      w={320}
      withArrow
      openDelay={400}
    >
      <Card
        withBorder
        p="sm"
        radius="sm"
        style={{
          cursor: 'pointer',
          borderColor: active ? 'var(--mantine-color-teal-6)' : undefined,
          backgroundColor: active
            ? 'var(--mantine-color-teal-light)'
            : undefined,
        }}
        onClick={onClick}
      >
        <Group gap={6} align="flex-start" wrap="nowrap">
          <Text size="xl" lh={1}>
            {recipe.emoji}
          </Text>
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text fw={600} size="sm" lh={1.2}>
              {recipe.name}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={2}>
              {recipe.description}
            </Text>
            <Group gap={6} mt={4}>
              <StarRating
                label="DPI"
                value={recipe.dpiResistance}
                color="violet"
              />
              <StarRating label="Speed" value={recipe.speed} color="orange" />
            </Group>
          </Stack>
        </Group>
      </Card>
    </Tooltip>
  );
}

function StarRating({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Group gap={1}>
      <Text size="xs" c="dimmed" fw={500} mr={2}>
        {label}
      </Text>
      {[1, 2, 3, 4, 5].map((i) =>
        i <= value ? (
          <IconStarFilled
            key={i}
            size={9}
            style={{ color: `var(--mantine-color-${color}-6)` }}
          />
        ) : (
          <IconStar key={i} size={9} style={{ color: 'var(--mantine-color-gray-5)' }} />
        ),
      )}
    </Group>
  );
}
