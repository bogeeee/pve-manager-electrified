/*
 * ConfirmRemoveDialog window with additional checkboxes for removing resources
 */
Ext.define('PVE.window.ConfirmRemoveResource', {
    extend: 'Proxmox.window.ConfirmRemoveDialog',
    alias: 'widget.pveConfirmRemoveResource',

    additionalItems: [
        {
            xtype: 'proxmoxcheckbox',
            name: 'purge',
            reference: 'purgeCheckbox',
            boxLabel: gettext('Purge resource from referenced HA rules'),
            padding: '5 0 0 0',
            checked: true,
            autoEl: {
                tag: 'div',
                'data-qtip': gettext(
                    'Also removes resource from HA rules and removes rule if there are no other resources in it',
                ),
            },
        },
    ],

    getText: function () {
        let me = this;

        me.text = `Are you sure you want to remove resource '${me.getItem().id}'?`;

        return me.callParent();
    },

    getParams: function () {
        let me = this;

        const purgeCheckbox = me.lookupReference('purgeCheckbox');
        me.params.purge = purgeCheckbox.checked ? 1 : 0;

        return me.callParent();
    },
});
