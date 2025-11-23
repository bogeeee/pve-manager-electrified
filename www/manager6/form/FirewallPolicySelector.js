Ext.define('PVE.form.FirewallPolicySelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: ['widget.pveFirewallPolicySelector'],
    comboItems: [
        ['ACCEPT', 'ACCEPT'],
        ['REJECT', 'REJECT'],
        ['DROP', 'DROP'],
    ],
});
