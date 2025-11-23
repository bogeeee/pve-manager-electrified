Ext.define(
    'PVE.ha.StatusView',
    {
        extend: 'Ext.grid.GridPanel',
        alias: ['widget.pveHAStatusView'],

        onlineHelp: 'chapter_ha_manager',

        sortPriority: {
            quorum: 1,
            master: 2,
            lrm: 3,
            service: 4,
        },

        initComponent: function () {
            var me = this;

            if (!me.rstore) {
                throw 'no rstore given';
            }

            Proxmox.Utils.monStoreErrors(me, me.rstore);

            var store = Ext.create('Proxmox.data.DiffStore', {
                rstore: me.rstore,
                sortAfterUpdate: true,
                sorters: [
                    {
                        sorterFn: function (rec1, rec2) {
                            var p1 = me.sortPriority[rec1.data.type];
                            var p2 = me.sortPriority[rec2.data.type];
                            return p1 !== p2 ? (p1 > p2 ? 1 : -1) : 0;
                        },
                    },
                ],
                filters: {
                    property: 'type',
                    value: 'service',
                    operator: '!=',
                },
            });

            Ext.apply(me, {
                store: store,
                stateful: false,
                viewConfig: {
                    trackOver: false,
                },
                columns: [
                    {
                        header: gettext('Type'),
                        width: 80,
                        dataIndex: 'type',
                    },
                    {
                        header: gettext('Status'),
                        width: 80,
                        flex: 1,
                        dataIndex: 'status',
                    },
                ],
            });

            me.callParent();

            me.on('activate', me.rstore.startUpdate);
            me.on('destroy', me.rstore.stopUpdate);
        },
    },
    function () {
        Ext.define('pve-ha-status', {
            extend: 'Ext.data.Model',
            fields: [
                'id',
                'type',
                'node',
                'status',
                'sid',
                'state',
                'comment',
                {
                    name: 'failback',
                    type: 'boolean',
                },
                'max_restart',
                'max_relocate',
                'type',
                'crm_state',
                'request_state',
                {
                    name: 'vname',
                    convert: function (value, record) {
                        let sid = record.data.sid;
                        if (!sid) {
                            return '';
                        }

                        let res = sid.match(/^(\S+):(\S+)$/);
                        if (res[1] !== 'vm' && res[1] !== 'ct') {
                            return '-';
                        }
                        let vmid = res[2];
                        return PVE.data.ResourceStore.guestName(vmid);
                    },
                },
            ],
            idProperty: 'id',
        });
    },
);
