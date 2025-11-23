Ext.define('PVE.sdn.Fabric.OpenFabric.Fabric.Edit', {
    extend: 'PVE.sdn.Fabric.Fabric.Edit',

    subject: 'OpenFabric',
    onlineHelp: 'pvesdn_openfabric_fabric',

    viewModel: {
        data: {
            showIpv6ForwardingHint: false,
        },
    },

    extraRequestParams: {
        protocol: 'openfabric',
    },

    additionalItems: [
        {
            xtype: 'displayfield',
            value: 'To make IPv6 fabrics work, enable global IPv6 forwarding on all nodes. Click on the Help button for more details.',
            bind: {
                hidden: '{!showIpv6ForwardingHint}',
            },
            userCls: 'pmx-hint',
        },
        {
            xtype: 'proxmoxtextfield',
            fieldLabel: gettext('IPv6 Prefix'),
            labelWidth: 120,
            name: 'ip6_prefix',
            allowBlank: true,
            skipEmptyText: true,
            cbind: {
                disabled: '{!isCreate}',
                deleteEmpty: '{!isCreate}',
            },
            listeners: {
                change: function (textbox, value) {
                    let vm = textbox.up('window').getViewModel();
                    vm.set('showIpv6ForwardingHint', !!value);
                },
            },
        },
        {
            xtype: 'proxmoxintegerfield',
            fieldLabel: gettext('Hello Interval'),
            labelWidth: 120,
            name: 'hello_interval',
            allowBlank: true,
            emptyText: '3',
            skipEmptyText: true,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
        {
            xtype: 'proxmoxintegerfield',
            fieldLabel: gettext('CSNP Interval'),
            labelWidth: 120,
            name: 'csnp_interval',
            allowBlank: true,
            emptyText: '10',
            skipEmptyText: true,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
    ],
});
