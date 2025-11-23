Ext.define('PVE.node.CephMonMgrList', {
    extend: 'Ext.container.Container',
    xtype: 'pveNodeCephMonMgr',

    mixins: ['Proxmox.Mixin.CBind'],

    onlineHelp: 'chapter_pveceph',

    defaults: {
        border: false,
        onlineHelp: 'chapter_pveceph',
        flex: 1,
    },

    layout: {
        type: 'vbox',
        align: 'stretch',
    },

    items: [
        {
            xtype: 'pveNodeCephServiceList',
            cbind: { pveSelNode: '{pveSelNode}' },
            type: 'mon',
            additionalColumns: [
                {
                    header: gettext('Quorum'),
                    width: 70,
                    sortable: true,
                    renderer: Proxmox.Utils.format_boolean,
                    dataIndex: 'quorum',
                },
            ],
            stateId: 'grid-ceph-monitor',
            showCephInstallMask: true,
            title: gettext('Monitor'),
        },
        {
            xtype: 'pveNodeCephServiceList',
            type: 'mgr',
            stateId: 'grid-ceph-manager',
            cbind: { pveSelNode: '{pveSelNode}' },
            title: gettext('Manager'),
        },
    ],
});
