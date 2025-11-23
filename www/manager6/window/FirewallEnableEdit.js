Ext.define('PVE.FirewallEnableEdit', {
    extend: 'Proxmox.window.Edit',
    alias: ['widget.pveFirewallEnableEdit'],
    mixins: ['Proxmox.Mixin.CBind'],

    subject: gettext('Firewall'),
    cbindData: {
        defaultValue: 0,
    },
    width: 350,

    items: [
        {
            xtype: 'proxmoxcheckbox',
            name: 'enable',
            uncheckedValue: 0,
            cbind: {
                defaultValue: '{defaultValue}',
                checked: '{defaultValue}',
            },
            deleteDefaultValue: false,
            fieldLabel: gettext('Firewall'),
        },
        {
            xtype: 'displayfield',
            name: 'warning',
            userCls: 'pmx-hint',
            value: gettext('Warning: Firewall still disabled at datacenter level!'),
            hidden: true,
        },
    ],

    beforeShow: function () {
        var me = this;

        Proxmox.Utils.API2Request({
            url: '/api2/extjs/cluster/firewall/options',
            method: 'GET',
            failure: function (response, opts) {
                Ext.Msg.alert(gettext('Error'), response.htmlStatus);
            },
            success: function (response, opts) {
                if (!response.result.data.enable) {
                    me.down('displayfield[name=warning]').setVisible(true);
                }
            },
        });
    },
});
