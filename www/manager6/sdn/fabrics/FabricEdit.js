Ext.define('PVE.sdn.Fabric.Fabric.Edit', {
    extend: 'Proxmox.window.Edit',
    mixins: ['Proxmox.Mixin.CBind'],

    width: 400,

    fabricId: undefined,
    baseUrl: '/cluster/sdn/fabrics/fabric',

    items: [
        {
            xtype: 'textfield',
            name: 'digest',
            hidden: true,
            allowBlank: true,
        },
        {
            xtype: 'proxmoxtextfield',
            fieldLabel: gettext('Name'),
            labelWidth: 120,
            maxLength: 8,
            name: 'id',
            cbind: {
                disabled: '{!isCreate}',
            },
        },
        {
            xtype: 'proxmoxtextfield',
            fieldLabel: gettext('IPv4 Prefix'),
            labelWidth: 120,
            name: 'ip_prefix',
            allowBlank: true,
            skipEmptyText: true,
            cbind: {
                disabled: '{!isCreate}',
                deleteEmpty: '{!isCreate}',
            },
        },
    ],

    additionalItems: [],

    initComponent: function () {
        let me = this;

        me.isCreate = me.fabricId === undefined;
        me.autoLoad = !me.isCreate;
        me.method = me.isCreate ? 'POST' : 'PUT';

        if (!me.isCreate) {
            me.url = `${me.baseUrl}/${me.fabricId}`;
        } else {
            me.url = me.baseUrl;
        }

        me.items.push(...me.additionalItems);

        me.callParent();
    },
});
