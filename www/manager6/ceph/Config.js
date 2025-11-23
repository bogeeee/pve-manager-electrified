Ext.define('PVE.node.CephConfigDb', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.pveNodeCephConfigDb',

    border: false,
    store: {
        proxy: {
            type: 'proxmox',
        },
    },

    columns: [
        {
            dataIndex: 'section',
            text: 'WHO',
            width: 100,
            renderer: Ext.htmlEncode,
        },
        {
            dataIndex: 'mask',
            text: 'MASK',
            hidden: true,
            width: 80,
            renderer: Ext.htmlEncode,
        },
        {
            dataIndex: 'level',
            hidden: true,
            text: 'LEVEL',
            renderer: Ext.htmlEncode,
        },
        {
            dataIndex: 'name',
            flex: 1,
            text: 'OPTION',
            renderer: Ext.htmlEncode,
        },
        {
            dataIndex: 'value',
            flex: 1,
            text: 'VALUE',
            renderer: Ext.htmlEncode,
        },
        {
            dataIndex: 'can_update_at_runtime',
            text: 'Runtime Updatable',
            hidden: true,
            width: 80,
            renderer: Proxmox.Utils.format_boolean,
        },
    ],

    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        me.store.proxy.url = '/api2/json/nodes/' + nodename + '/ceph/cfg/db';

        me.callParent();

        Proxmox.Utils.monStoreErrors(me, me.getStore());
        me.getStore().load();
    },
});
Ext.define('PVE.node.CephConfig', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveNodeCephConfig',

    bodyStyle: 'white-space:pre',
    bodyPadding: 5,
    border: false,
    scrollable: true,
    load: function () {
        var me = this;

        Proxmox.Utils.API2Request({
            url: me.url,
            waitMsgTarget: me,
            failure: function (response, opts) {
                me.update(gettext('Error') + ' ' + response.htmlStatus);
                var msg = response.htmlStatus;
                PVE.Utils.showCephInstallOrMask(
                    me.ownerCt,
                    msg,
                    me.pveSelNode.data.node,
                    function (win) {
                        me.mon(win, 'cephInstallWindowClosed', function () {
                            me.load();
                        });
                    },
                );
            },
            success: function (response, opts) {
                var data = response.result.data;
                me.update(Ext.htmlEncode(data));
            },
        });
    },

    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        Ext.apply(me, {
            url: '/nodes/' + nodename + '/ceph/cfg/raw',
            listeners: {
                activate: function () {
                    me.load();
                },
            },
        });

        me.callParent();

        me.load();
    },
});

Ext.define('PVE.node.CephConfigCrush', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveNodeCephConfigCrush',

    onlineHelp: 'chapter_pveceph',

    layout: 'border',
    items: [
        {
            title: gettext('Configuration'),
            xtype: 'pveNodeCephConfig',
            region: 'center',
        },
        {
            title: 'Crush Map', // do not localize
            xtype: 'pveNodeCephCrushMap',
            region: 'east',
            split: true,
            width: '50%',
        },
        {
            title: gettext('Configuration Database'),
            xtype: 'pveNodeCephConfigDb',
            region: 'south',
            split: true,
            weight: -30,
            height: '50%',
        },
    ],

    initComponent: function () {
        var me = this;
        me.defaults = {
            pveSelNode: me.pveSelNode,
        };
        me.callParent();
    },
});
