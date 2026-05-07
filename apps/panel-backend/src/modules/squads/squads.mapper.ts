import type { Group, GroupInbound } from '../../generated/prisma/client.js';

export interface PublicSquadDto {
  id: string;
  name: string;
  description: string | null;
  inboundIds: string[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

type SquadWithRelations = Group & {
  groupInbounds: Pick<GroupInbound, 'inboundId'>[];
  _count?: { members: number };
};

export function mapSquadToPublic(squad: SquadWithRelations): PublicSquadDto {
  return {
    id: squad.id,
    name: squad.name,
    description: squad.description,
    inboundIds: squad.groupInbounds.map((gi) => gi.inboundId),
    memberCount: squad._count?.members ?? 0,
    createdAt: squad.createdAt.toISOString(),
    updatedAt: squad.updatedAt.toISOString(),
  };
}
