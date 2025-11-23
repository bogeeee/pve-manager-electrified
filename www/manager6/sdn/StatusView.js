Ext.define(
    'PVE.sdn.StatusView',
    {
        extend: 'Ext.grid.GridPanel',
        alias: 'widget.pveSDNStatusView',

        sortPriority: {
            sdn: 1,
            node: 2,
            status: 3,
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
                    value: 'network',
                    operator: '==',
                },
            });

            Ext.apply(me, {
                store: store,
                stateful: false,
                tbar: [
                    {
                        text: gettext('Apply'),
                        handler: function () {
                            Ext.Msg.show({
                                title: gettext('Confirm'),
                                icon: Ext.Msg.QUESTION,
                                msg: gettext(
                                    'Applying pending SDN changes will also apply any pending local node network changes. Proceed?',
                                ),
                                buttons: Ext.Msg.YESNO,
                                callback: function (btn) {
                                    if (btn === 'yes') {
                                        Proxmox.Utils.API2Request({
                                            url: '/cluster/sdn/',
                                            method: 'PUT',
                                            waitMsgTarget: me,
                                            failure: (response) =>
                                                Ext.Msg.alert(
                                                    gettext('Error'),
                                                    response.htmlStatus,
                                                ),
                                        });
                                    }
                                },
                            });
                        },
                    },
                ],
                viewConfig: {
                    trackOver: false,
                },
                columns: [
                    {
                        header: 'SDN',
                        width: 80,
                        dataIndex: 'network',
                    },
                    {
                        header: gettext('Node'),
                        width: 80,
                        dataIndex: 'node',
                    },
                    {
                        header: gettext('Type'),
                        width: 80,
                        dataIndex: 'network-type',
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
        Ext.define('pve-sdn-status', {
            extend: 'Ext.data.Model',
            fields: ['id', 'type', 'node', 'status', 'network'],
            idProperty: 'id',
        });
    },
);
